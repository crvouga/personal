import { spawn } from 'node:child_process';
import { ManagerError } from '../domain/errors.ts';
export interface Command {
  executable: string;
  args: string[];
  input?: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  maxBytes?: number;
}
/** Never forward stderr or native error messages: they can contain vault data. */
export async function command(input: Command): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(input.executable, input.args, {
      env: input.env ?? baseEnvironment(),
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: input.timeoutMs ?? 60_000,
      killSignal: 'SIGKILL',
    });
    const chunks: Buffer[] = [];
    let bytes = 0;
    child.stdout.on('data', (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > (input.maxBytes ?? 32 * 1024 * 1024)) child.kill('SIGKILL');
      else chunks.push(chunk);
    });
    child.stderr.on('data', () => {});
    child.on('error', () => reject(new ManagerError('unavailable')));
    child.stdin.on('error', () => {});
    child.on('close', (code) => {
      if (code !== 0) reject(new ManagerError('unavailable'));
      else resolve(Buffer.concat(chunks).toString('utf8'));
    });
    child.stdin.end(input.input);
  });
}
export function baseEnvironment(): NodeJS.ProcessEnv {
  const allowed = [
    'HOME',
    'USER',
    'TMPDIR',
    'TEMP',
    'LANG',
    'LC_ALL',
    'SystemRoot',
    'DBUS_SESSION_BUS_ADDRESS',
    'XDG_RUNTIME_DIR',
    'DISPLAY',
    'WAYLAND_DISPLAY',
  ];
  return Object.fromEntries(
    allowed.flatMap((key) =>
      process.env[key] ? [[key, process.env[key]]] : []
    )
  );
}
