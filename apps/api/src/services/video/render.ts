import fs from 'node:fs/promises';
import path from 'node:path';
import { ffmpeg, probe } from './ffmpeg';

export interface RenderScene {
  clipPath: string;
  /** Seconds this scene occupies on the final timeline. */
  duration: number;
}

export interface RenderInput {
  workDir: string;
  scenes: RenderScene[];
  narrationPath: string;
  /** atempo factor applied to narration (1 = unchanged). Scene durations must already be on the final timeline. */
  narrationTempo: number;
  totalDuration: number;
  musicPath?: string;
  musicVolume: number;
  sfxIntensity: number;
  subtitleList?: string;
  colorGrade: string;
  transition: string;
  transitionDuration: number;
  /** Disable the slow push-in when the provider applies a visible watermark (never crop attribution). */
  allowPushIn: boolean;
  fps: number;
  crf: number;
  preset: string;
  loudnessLufs: number;
  logoPath?: string;
  logoPosition: 'top-left' | 'top-right';
  output: string;
  thumbnail: string;
  onProgress?: (fraction: number, stage: string) => void;
}

const W = 1080;
const H = 1920;

/**
 * Fits any clip to 1080×1920 without cropping its content: the clip is scaled to fit and placed over a
 * blurred, scaled-to-fill copy of itself (safe reframing — provider watermarks are never cropped out).
 */
function fitFilter(input: string, out: string) {
  return (
    `[${input}]split=2[bgsrc${out}][fgsrc${out}];` +
    `[bgsrc${out}]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},boxblur=28:2,eq=brightness=-0.06[bg${out}];` +
    `[fgsrc${out}]scale=${W}:${H}:force_original_aspect_ratio=decrease[fg${out}];` +
    `[bg${out}][fg${out}]overlay=(W-w)/2:(H-h)/2,setsar=1[${out}]`
  );
}

/**
 * Turns a still image into a scene clip: the whole image slowly grows from 90% to 100% of the frame over a
 * blurred copy of itself. The image is never cropped, so a visible watermark on it stays visible.
 */
export async function stillToClip(image: string, dest: string, length: number, fps = 24) {
  const t = length.toFixed(3);
  await ffmpeg(
    [
      '-loop', '1', '-framerate', String(fps), '-t', t, '-i', image,
      '-filter_complex',
      `[0:v]split=2[bgsrc][fgsrc];` +
        `[bgsrc]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},boxblur=28:2,eq=brightness=-0.06[bg];` +
        `[fgsrc]scale=${W}:${H}:force_original_aspect_ratio=decrease,scale=w='trunc(iw*(0.9+0.1*t/${t})/2)*2':h=-2:eval=frame[fg];` +
        `[bg][fg]overlay=(W-w)/2:(H-h)/2:eval=frame,setsar=1,format=yuv420p[v]`,
      '-map', '[v]', '-r', String(fps), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-an', '-movflags', '+faststart', dest,
    ],
    { timeoutMs: 5 * 60_000 },
  );
}

/** Normalises one generated clip to exactly `length` seconds at 1080×1920/fps with a stereo audio track. */
export async function normalizeClip(src: string, dest: string, length: number, opts: Pick<RenderInput, 'fps' | 'colorGrade' | 'allowPushIn'>) {
  const info = await probe(src);
  const clipLen = Math.max(0.1, info.duration || length);
  const slow = clipLen < length ? Math.min(1.25, length / clipLen) : 1;
  const padAfterSlow = Math.max(0, length - clipLen * slow);
  const push = opts.allowPushIn ? `,scale=w='trunc(${W}*(1+0.035*t/${length.toFixed(3)})/2)*2':h=-2:eval=frame,crop=${W}:${H}` : '';
  const v =
    fitFilter('0:v', 'fit') +
    `;[fit]setpts=PTS*${slow.toFixed(4)}${padAfterSlow > 0 ? `,tpad=stop_mode=clone:stop_duration=${padAfterSlow.toFixed(3)}` : ''},trim=duration=${length.toFixed(3)},setpts=PTS-STARTPTS${push},${opts.colorGrade ? `${opts.colorGrade},` : ''}fps=${opts.fps},format=yuv420p[v]`;
  const a = info.hasAudio
    ? `;[0:a]aresample=48000,aformat=channel_layouts=stereo,atempo=${(1 / slow).toFixed(4)},apad,atrim=duration=${length.toFixed(3)},asetpts=PTS-STARTPTS[a]`
    : `;anullsrc=r=48000:cl=stereo,atrim=duration=${length.toFixed(3)}[a]`;
  await ffmpeg(['-i', src, '-filter_complex', v + a, '-map', '[v]', '-map', '[a]', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '16', '-c:a', 'aac', '-b:a', '192k', '-t', length.toFixed(3), dest]);
  return { slow, padded: padAfterSlow };
}

export async function renderVideo(input: RenderInput) {
  const T = input.transition === 'none' ? 0 : input.transitionDuration;
  const n = input.scenes.length;
  await fs.mkdir(input.workDir, { recursive: true });

  // 1. Normalise every scene to its slot (+ overlap for the transition into the next scene).
  const normalized: string[] = [];
  for (let i = 0; i < n; i++) {
    const s = input.scenes[i]!;
    const len = s.duration + (i < n - 1 ? T : 0);
    const dest = path.join(input.workDir, `scene-${String(i + 1).padStart(2, '0')}.mp4`);
    await normalizeClip(s.clipPath, dest, len, input);
    normalized.push(dest);
    input.onProgress?.((i + 1) / n * 0.5, `normalising scene ${i + 1}/${n}`);
  }

  // 2. Build the final graph.
  const args: string[] = [];
  normalized.forEach((f) => args.push('-i', f));
  const narIdx = n;
  args.push('-i', input.narrationPath);
  let musicIdx = -1;
  if (input.musicPath) {
    musicIdx = n + 1;
    args.push('-stream_loop', '-1', '-i', input.musicPath);
  }
  let subIdx = -1;
  if (input.subtitleList) {
    subIdx = musicIdx >= 0 ? n + 2 : n + 1;
    args.push('-f', 'concat', '-safe', '0', '-i', input.subtitleList);
  }
  let logoIdx = -1;
  if (input.logoPath) {
    logoIdx = Math.max(narIdx, musicIdx, subIdx) + 1;
    args.push('-i', input.logoPath);
  }

  const total = input.totalDuration;
  const f: string[] = [];
  // Video: chained cross-fades. offset_k = sum of the first k scene durations.
  if (n === 1) f.push('[0:v]null[vx]');
  else {
    let prev = '0:v';
    let offset = 0;
    for (let i = 1; i < n; i++) {
      offset += input.scenes[i - 1]!.duration;
      const out = i === n - 1 ? 'vx' : `x${i}`;
      f.push(T > 0 ? `[${prev}][${i}:v]xfade=transition=${input.transition}:duration=${T}:offset=${offset.toFixed(3)}[${out}]` : `[${prev}][${i}:v]concat=n=2:v=1:a=0[${out}]`);
      prev = out;
    }
  }
  // Scene ambience (generated audio) cross-fades in step with the picture.
  if (n === 1) f.push('[0:a]anull[sfx]');
  else {
    let prev = '0:a';
    for (let i = 1; i < n; i++) {
      const out = i === n - 1 ? 'sfx' : `ax${i}`;
      f.push(T > 0 ? `[${prev}][${i}:a]acrossfade=d=${T}:c1=tri:c2=tri[${out}]` : `[${prev}][${i}:a]concat=n=2:v=0:a=1[${out}]`);
      prev = out;
    }
  }
  const tempo = input.narrationTempo;
  f.push(
    `[${narIdx}:a]aresample=48000,aformat=channel_layouts=stereo${Math.abs(tempo - 1) > 0.001 ? `,atempo=${tempo.toFixed(4)}` : ''},loudnorm=I=${input.loudnessLufs}:TP=-1.5:LRA=11,apad,atrim=duration=${total.toFixed(3)}[nar]`,
  );
  const mixInputs = ['[nar1]'];
  f.push('[nar]asplit=3[nar1][narsc1][narsc2]');
  f.push(`[sfx]volume=${(input.sfxIntensity * 0.7).toFixed(3)},apad,atrim=duration=${total.toFixed(3)}[sfxv]`);
  // Ambience ducks lightly under narration; music ducks strongly.
  f.push('[sfxv][narsc1]sidechaincompress=threshold=0.03:ratio=3:attack=30:release=500[sfxd]');
  mixInputs.push('[sfxd]');
  if (musicIdx >= 0) {
    f.push(`[${musicIdx}:a]aresample=48000,aformat=channel_layouts=stereo,atrim=duration=${total.toFixed(3)},volume=${input.musicVolume.toFixed(3)}[mus]`);
    f.push('[mus][narsc2]sidechaincompress=threshold=0.02:ratio=10:attack=20:release=450[musd]');
    mixInputs.push('[musd]');
  } else f.push('[narsc2]anullsink');
  f.push(
    `${mixInputs.join('')}amix=inputs=${mixInputs.length}:normalize=0:duration=first,alimiter=limit=0.95,afade=t=in:d=0.15,afade=t=out:st=${Math.max(0, total - 0.8).toFixed(3)}:d=0.8[aout]`,
  );

  let vLabel = 'vx';
  if (subIdx >= 0) {
    f.push(`[${subIdx}:v]fps=${input.fps},format=rgba[subs]`);
    f.push(`[${vLabel}][subs]overlay=0:0:eof_action=pass:format=auto[vs]`);
    vLabel = 'vs';
  }
  if (logoIdx >= 0) {
    f.push(`[${logoIdx}:v]scale=150:-1,format=rgba,colorchannelmixer=aa=0.85[logo]`);
    const pos = input.logoPosition === 'top-left' ? '60:110' : 'W-w-60:110';
    f.push(`[${vLabel}][logo]overlay=${pos}[vl]`);
    vLabel = 'vl';
  }
  f.push(`[${vLabel}]fade=t=in:d=0.25,fade=t=out:st=${Math.max(0, total - 0.6).toFixed(3)}:d=0.6,format=yuv420p[vout]`);

  await ffmpeg(
    [
      ...args,
      '-filter_complex', f.join(';'),
      '-map', '[vout]', '-map', '[aout]',
      '-c:v', 'libx264', '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-preset', input.preset, '-crf', String(input.crf), '-r', String(input.fps),
      '-c:a', 'aac', '-b:a', '192k', '-ar', '48000',
      '-movflags', '+faststart',
      '-t', total.toFixed(3),
      input.output,
    ],
    { totalSeconds: total, onProgress: (p) => input.onProgress?.(0.5 + p * 0.48, 'encoding final video') },
  );
  await ffmpeg(['-ss', Math.min(1.5, total / 2).toFixed(2), '-i', input.output, '-frames:v', '1', '-q:v', '3', input.thumbnail]);
  input.onProgress?.(1, 'done');
  return probe(input.output);
}
