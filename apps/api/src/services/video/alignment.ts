import type { Alignment } from '../../providers/tts/elevenlabs';

export interface TimedWord {
  text: string;
  start: number;
  end: number;
  /** Index of the sentence the word belongs to. */
  sentence: number;
}

export interface Segment {
  id: number;
  text: string;
  start: number;
  end: number;
  words: TimedWord[];
}

const SENTENCE_END = /[।॥?!.]$/;

/** Groups character-level alignment into words (whitespace-separated) with start/end times. */
export function wordsFromAlignment(a: Alignment): TimedWord[] {
  const words: TimedWord[] = [];
  let buf = '';
  let start = -1;
  let end = 0;
  let sentence = 0;
  const flush = () => {
    if (!buf.trim()) return;
    words.push({ text: buf.trim(), start: Math.max(0, start), end, sentence });
    if (SENTENCE_END.test(buf.trim()) || /…$/.test(buf.trim())) sentence++;
    buf = '';
    start = -1;
  };
  a.characters.forEach((ch, i) => {
    if (/\s/.test(ch)) {
      flush();
      return;
    }
    if (start < 0) start = a.character_start_times_seconds[i] ?? end;
    end = a.character_end_times_seconds[i] ?? end;
    buf += ch;
  });
  flush();
  return words;
}

/**
 * Splits narration into timed segments at sentence boundaries; sentences longer than maxSeconds are split
 * at the word nearest their midpoint (repeatedly) so each segment fits a provider clip.
 */
export function segmentsFromWords(words: TimedWord[], maxSeconds: number): Segment[] {
  const groups: TimedWord[][] = [];
  for (const w of words) {
    const g = groups[w.sentence] ?? (groups[w.sentence] = []);
    g.push(w);
  }
  const out: TimedWord[][] = [];
  const split = (g: TimedWord[]) => {
    const dur = g.at(-1)!.end - g[0]!.start;
    if (dur <= maxSeconds || g.length < 4) {
      out.push(g);
      return;
    }
    const mid = g[0]!.start + dur / 2;
    // Prefer splitting after a comma near the middle.
    let idx = g.findIndex((w) => w.end >= mid);
    const commaIdx = g.findIndex((w, i) => i > 0 && i < g.length - 1 && /[,;—–]$/.test(w.text) && Math.abs(w.end - mid) < dur / 4);
    if (commaIdx > 0) idx = commaIdx;
    idx = Math.min(Math.max(idx, 1), g.length - 2);
    split(g.slice(0, idx + 1));
    split(g.slice(idx + 1));
  };
  groups.filter(Boolean).forEach(split);
  return out.map((g, i) => ({ id: i + 1, text: g.map((w) => w.text).join(' '), start: g[0]!.start, end: g.at(-1)!.end, words: g }));
}

/** Fallback when a provider returns no alignment: distribute time by syllable-ish length. */
export function syntheticAlignment(text: string, duration: number): Alignment {
  const chars = [...text];
  const weights = chars.map((c) => (/\s/.test(c) ? 0.6 : /[,]/.test(c) ? 3 : /[।?!.]/.test(c) ? 6 : 1));
  const total = weights.reduce((a, b) => a + b, 0);
  let t = 0;
  const starts: number[] = [];
  const ends: number[] = [];
  for (const w of weights) {
    starts.push(t);
    t += (w / total) * duration;
    ends.push(t);
  }
  return { characters: chars, character_start_times_seconds: starts, character_end_times_seconds: ends };
}
