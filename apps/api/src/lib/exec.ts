import { spawn } from 'node:child_process';

export interface ExecResult {
  stdout: string;
  stderr: string;
  code: number;
}

/** Runs a binary without a shell (no injection surface). Rejects on non-zero exit unless allowFailure. */
export function run(
  cmd: string,
  args: string[],
  opts: { cwd?: string; timeoutMs?: number; allowFailure?: boolean; maxBuffer?: number; onStderr?: (chunk: string) => void } = {},
): Promise<ExecResult> {
  const maxBuffer = opts.maxBuffer ?? 256 * 1024 * 1024;
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd: opts.cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    const out: Buffer[] = [];
    let outLen = 0;
    let stderr = '';
    let timer: NodeJS.Timeout | undefined;
    if (opts.timeoutMs) timer = setTimeout(() => child.kill('SIGKILL'), opts.timeoutMs);
    child.stdout.on('data', (d: Buffer) => {
      outLen += d.length;
      if (outLen <= maxBuffer) out.push(d);
    });
    child.stderr.on('data', (d: Buffer) => {
      const s = d.toString();
      opts.onStderr?.(s);
      stderr = (stderr + s).slice(-20_000);
    });
    child.on('error', (err) => {
      if (timer) clearTimeout(timer);
      reject(Object.assign(err, { message: `${cmd}: ${err.message}` }));
    });
    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
      const result = { stdout: Buffer.concat(out).toString('utf8'), stderr, code: code ?? -1 };
      if (result.code !== 0 && !opts.allowFailure) {
        reject(new Error(`${cmd} exited with ${result.code}: ${stderr.slice(-2000)}`));
      } else resolve(result);
    });
  });
}

export async function binaryAvailable(cmd: string, versionArgs = ['-version']): Promise<string | null> {
  try {
    const r = await run(cmd, versionArgs, { allowFailure: true, timeoutMs: 10_000 });
    const line = (r.stdout || r.stderr).split('\n').find((l) => l.trim());
    return line?.trim() ?? cmd;
  } catch {
    return null;
  }
}
