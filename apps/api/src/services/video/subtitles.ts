import fs from 'node:fs/promises';
import path from 'node:path';
import { createCanvas, GlobalFonts, type SKRSContext2D } from '@napi-rs/canvas';
import type { SubtitleSettings } from '@mas/shared';
import type { TimedWord } from './alignment';

export interface Cue {
  index: number;
  start: number;
  end: number;
  words: TimedWord[];
}

const W = 1080;
const H = 1920;

let fontsLoaded = false;
/** Registers any user-provided fonts in <storage>/library/fonts in addition to system fonts. */
export async function loadFonts(fontDir: string) {
  if (fontsLoaded) return;
  fontsLoaded = true;
  try {
    for (const f of await fs.readdir(fontDir)) if (/\.(ttf|otf|ttc)$/i.test(f)) GlobalFonts.registerFromPath(path.join(fontDir, f));
  } catch {
    /* no custom fonts */
  }
}

export function availableFonts(): string[] {
  return [...new Set(GlobalFonts.families.map((f) => f.family))].sort();
}

const clean = (w: string) => w.replace(/[।॥,.!?;:"'“”‘’…—–-]/g, '');

/** Groups words into readable cues: ≤ maxChars, ≤ maxSeconds, never spanning a sentence boundary. */
export function buildCues(words: TimedWord[], maxChars = 34, maxSeconds = 3.2): Cue[] {
  const cues: Cue[] = [];
  let cur: TimedWord[] = [];
  const push = () => {
    if (!cur.length) return;
    cues.push({ index: cues.length + 1, start: cur[0]!.start, end: cur.at(-1)!.end, words: cur });
    cur = [];
  };
  for (const w of words) {
    if (cur.length) {
      const len = cur.map((x) => x.text).join(' ').length + 1 + w.text.length;
      const dur = w.end - cur[0]!.start;
      if (w.sentence !== cur[0]!.sentence || len > maxChars || dur > maxSeconds) push();
    }
    cur.push(w);
  }
  push();
  // Close small gaps so subtitles don't flicker between consecutive cues.
  for (let i = 0; i < cues.length - 1; i++) {
    const gap = cues[i + 1]!.start - cues[i]!.end;
    if (gap > 0 && gap < 0.35) cues[i]!.end = cues[i + 1]!.start;
  }
  return cues;
}

function ts(t: number, sep: ',' | '.') {
  const ms = Math.max(0, Math.round(t * 1000));
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  const r = ms % 1000;
  return sep === ','
    ? `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(r).padStart(3, '0')}`
    : `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(Math.floor(r / 10)).padStart(2, '0')}`;
}

export function toSrt(cues: Cue[]): string {
  return cues.map((c) => `${c.index}\n${ts(c.start, ',')} --> ${ts(c.end, ',')}\n${c.words.map((w) => w.text).join(' ')}\n`).join('\n');
}

function assColor(hex: string, alpha = 0) {
  const h = hex.replace('#', '');
  const a = Math.round(alpha * 255).toString(16).padStart(2, '0').toUpperCase();
  return `&H${a}${h.slice(4, 6)}${h.slice(2, 4)}${h.slice(0, 2)}`.toUpperCase();
}

/** ASS subtitles (karaoke \k timing + highlight colour overrides), 1080×1920 play resolution. */
export function toAss(cues: Cue[], s: SubtitleSettings, highlight: Set<string>): string {
  const marginV = Math.round(H * s.positionFromBottom);
  const header = `[Script Info]
ScriptType: v4.00+
PlayResX: ${W}
PlayResY: ${H}
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,${s.font},${s.fontSize},${assColor(s.textColor)},${assColor(s.highlightColor)},&H00000000,${assColor('#000000', 1 - s.backgroundOpacity)},1,0,0,0,100,100,0,0,${s.backgroundOpacity > 0 ? 3 : 1},4,0,2,90,150,${marginV},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;
  const lines = cues.map((c) => {
    const text = c.words
      .map((w, i) => {
        const k = s.animation === 'karaoke' ? `{\\k${Math.max(1, Math.round(((c.words[i + 1]?.start ?? w.end) - w.start) * 100))}}` : '';
        const hl = s.animation !== 'karaoke' && highlight.has(clean(w.text)) ? `{\\c${assColor(s.highlightColor)}}${w.text}{\\c${assColor(s.textColor)}}` : w.text;
        return k + hl;
      })
      .join(' ');
    const fx = s.animation === 'fade' ? '{\\fad(120,120)}' : s.animation === 'pop' ? '{\\fscx92\\fscy92\\t(0,120,\\fscx100\\fscy100)}' : '';
    return `Dialogue: 0,${ts(c.start, '.')},${ts(c.end, '.')},Default,,0,0,0,,${fx}${text}`;
  });
  return header + lines.join('\n') + '\n';
}

function wrapWords(ctx: SKRSContext2D, words: string[], maxWidth: number): string[][] {
  const lines: string[][] = [[]];
  for (const w of words) {
    const line = lines.at(-1)!;
    const candidate = [...line, w].join(' ');
    if (line.length && ctx.measureText(candidate).width > maxWidth) lines.push([w]);
    else line.push(w);
  }
  return lines;
}

/**
 * Renders one transparent 1080×1920 PNG per subtitle state. Text is shaped by Skia/HarfBuzz, so
 * Devanagari conjuncts and matras render correctly (FFmpeg drawtext/libass are not required).
 * Subtitles sit above the bottom UI of Shorts/Reels and are shifted left of the right-side action rail.
 */
export function renderCueImage(words: string[], activeIndex: number | null, s: SubtitleSettings, highlight: Set<string>): Buffer {
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  const family = `"${s.font}", "Kohinoor Devanagari", "Noto Sans Devanagari", "Devanagari Sangam MN", sans-serif`;
  ctx.font = `700 ${s.fontSize}px ${family}`;
  const marginL = 80;
  const marginR = 170; // keep clear of the like/comment/share rail
  const maxWidth = W - marginL - marginR;
  const lines = wrapWords(ctx, words, maxWidth).slice(0, 3);
  const lineH = Math.round(s.fontSize * 1.45);
  const blockH = lines.length * lineH;
  const baseY = Math.round(H * (1 - s.positionFromBottom));
  const top = baseY - blockH;
  const centerX = marginL + maxWidth / 2;

  if (s.backgroundOpacity > 0) {
    const widest = Math.max(...lines.map((l) => ctx.measureText(l.join(' ')).width));
    const padX = 34;
    const padY = 18;
    const x = centerX - widest / 2 - padX;
    const y = top - padY;
    const w = widest + padX * 2;
    const h = blockH + padY * 2;
    ctx.fillStyle = `rgba(0,0,0,${s.backgroundOpacity})`;
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, 26);
    ctx.fill();
  }

  ctx.textBaseline = 'alphabetic';
  ctx.lineJoin = 'round';
  let wordIdx = 0;
  lines.forEach((line, li) => {
    const lineText = line.join(' ');
    let x = centerX - ctx.measureText(lineText).width / 2;
    const y = top + (li + 1) * lineH - Math.round(lineH * 0.28);
    for (const w of line) {
      const isActive = activeIndex === wordIdx;
      const isKey = highlight.has(clean(w));
      ctx.lineWidth = Math.max(6, Math.round(s.fontSize / 9));
      ctx.strokeStyle = 'rgba(0,0,0,0.85)';
      ctx.strokeText(w, x, y);
      ctx.fillStyle = isActive || (activeIndex === null && isKey) ? s.highlightColor : s.textColor;
      ctx.fillText(w, x, y);
      x += ctx.measureText(`${w} `).width;
      wordIdx++;
    }
  });
  return canvas.toBuffer('image/png');
}

/**
 * Writes subtitle overlay frames plus an FFmpeg concat list (image + duration) covering [0, total].
 * Returns the list path; it is used as a transparent overlay input.
 */
export async function writeSubtitleOverlay(dir: string, cues: Cue[], total: number, s: SubtitleSettings, highlight: Set<string>): Promise<string> {
  await fs.mkdir(dir, { recursive: true });
  const blank = path.join(dir, 'blank.png');
  await fs.writeFile(blank, createCanvas(W, H).toBuffer('image/png'));
  const entries: { file: string; dur: number }[] = [];
  let t = 0;
  let n = 0;
  const add = async (img: Buffer | null, until: number) => {
    const dur = until - t;
    if (dur <= 0.001) return;
    let file = blank;
    if (img) {
      file = path.join(dir, `sub-${String(n++).padStart(4, '0')}.png`);
      await fs.writeFile(file, img);
    }
    entries.push({ file, dur });
    t = until;
  };
  for (const c of cues) {
    if (c.start >= total) break;
    await add(null, c.start);
    const words = c.words.map((w) => w.text);
    if (s.animation === 'karaoke') {
      for (let i = 0; i < c.words.length; i++) {
        const until = Math.min(total, i + 1 < c.words.length ? c.words[i + 1]!.start : c.end);
        await add(renderCueImage(words, i, s, highlight), Math.max(until, t + 0.04));
      }
    } else {
      await add(renderCueImage(words, null, s, highlight), Math.min(total, c.end));
    }
  }
  await add(null, total);
  const list = entries.map((e) => `file '${e.file.replace(/'/g, "'\\''")}'\nduration ${e.dur.toFixed(3)}`).join('\n');
  const listPath = path.join(dir, 'subtitles.txt');
  // The concat demuxer needs the final file repeated (without duration) to honour the last duration.
  await fs.writeFile(listPath, `ffconcat version 1.0\n${list}\nfile '${entries.at(-1)?.file ?? blank}'\n`);
  return listPath;
}
