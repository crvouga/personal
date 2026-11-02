import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { delimiter, join } from 'node:path';

export type RunResult = {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly ms: number;
  readonly timedOut: boolean;
};

type RunOpts = { readonly timeoutMs: number; readonly input?: string };

/** Spawn a process with a hard timeout. Never throws — failures are results. */
export function run(
  cmd: string,
  args: readonly string[],
  opts: RunOpts
): Promise<RunResult> {
  return new Promise((resolve) => {
    const started = Date.now();
    const out = { stdout: '', stderr: '', timedOut: false };
    const child = spawn(cmd, [...args], { stdio: ['pipe', 'pipe', 'pipe'] });
    const timer = setTimeout(() => {
      out.timedOut = true;
      child.kill('SIGKILL');
    }, opts.timeoutMs);
    const finish = (status: number | null, extra = ''): void => {
      clearTimeout(timer);
      const ms = Date.now() - started;
      resolve({ ...out, stderr: out.stderr + extra, status, ms });
    };
    child.stdout.on('data', (d: Buffer) => (out.stdout += d.toString()));
    child.stderr.on('data', (d: Buffer) => (out.stderr += d.toString()));
    child.on('error', (e) => finish(null, e.message));
    child.on('close', (code) => finish(code));
    child.stdin.on('error', () => undefined);
    child.stdin.end(opts.input ?? '');
  });
}

/** Last non-empty line of a command's output (for compact error details). */
export function lastLine(text: string): string {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  return lines[lines.length - 1] ?? '';
}

/** Resolve an executable on PATH (also tries Windows `.exe` / `.cmd`). */
export function findOnPath(
  name: string,
  pathEnv: string = process.env['PATH'] ?? ''
): string | null {
  for (const dir of pathEnv.split(delimiter)) {
    if (dir.length === 0) continue;
    for (const candidate of [name, `${name}.exe`, `${name}.cmd`]) {
      const full = join(dir, candidate);
      if (existsSync(full)) return full;
    }
  }
  return null;
}
