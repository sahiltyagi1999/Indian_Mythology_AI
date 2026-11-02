import { env } from '../../config/env';
import { run } from '../../lib/exec';

export interface ProbeResult {
  duration: number;
  width?: number;
  height?: number;
  fps?: number;
  hasAudio: boolean;
  hasVideo: boolean;
  size: number;
}

export async function probe(file: string): Promise<ProbeResult> {
  const { stdout } = await run(env.FFPROBE_PATH, ['-v', 'error', '-show_entries', 'format=duration,size:stream=codec_type,width,height,r_frame_rate', '-of', 'json', file], {
    timeoutMs: 60_000,
  });
  const j = JSON.parse(stdout);
  const v = (j.streams ?? []).find((s: any) => s.codec_type === 'video');
  const [num, den] = String(v?.r_frame_rate ?? '0/1').split('/').map(Number);
  return {
    duration: parseFloat(j.format?.duration ?? '0'),
    size: parseInt(j.format?.size ?? '0', 10),
    width: v?.width,
    height: v?.height,
    fps: den ? num! / den : undefined,
    hasVideo: !!v,
    hasAudio: (j.streams ?? []).some((s: any) => s.codec_type === 'audio'),
  };
}

/** Runs ffmpeg with -y and a progress callback parsed from `time=` in stderr. */
export async function ffmpeg(args: string[], opts: { timeoutMs?: number; totalSeconds?: number; onProgress?: (fraction: number) => void } = {}) {
  return run(env.FFMPEG_PATH, ['-hide_banner', '-nostdin', '-y', ...args], {
    timeoutMs: opts.timeoutMs ?? 30 * 60_000,
    onStderr: (s) => {
      if (!opts.onProgress || !opts.totalSeconds) return;
      const m = s.match(/time=(\d+):(\d+):(\d+\.\d+)/);
      if (m) opts.onProgress(Math.min(1, (+m[1]! * 3600 + +m[2]! * 60 + +m[3]!) / opts.totalSeconds));
    },
  });
}
