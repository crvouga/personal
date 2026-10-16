import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';

export interface RunningServer {
  url: string;
  stop: () => Promise<void>;
}

async function stop(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) return;
  await new Promise<void>((resolve) => {
    const timeout = setTimeout(() => child.kill('SIGKILL'), 3_000);
    child.once('exit', () => {
      clearTimeout(timeout);
      resolve();
    });
    child.kill('SIGTERM');
  });
}

export async function startServer(
  args: string[],
  env: NodeJS.ProcessEnv = {}
): Promise<RunningServer> {
  const child = spawn(args[0]!, args.slice(1), {
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  try {
    const url = await new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error('Test server did not start')),
        20_000
      );
      const finish = (error: Error) => {
        clearTimeout(timeout);
        reject(error);
      };
      child.once('error', finish);
      child.once('exit', () =>
        finish(new Error('Test server exited before becoming ready'))
      );
      child.stderr?.on('data', () => undefined);
      child.stdout?.on('data', (chunk: Buffer) => {
        const match = chunk
          .toString()
          .match(/http:\/\/127\.0\.0\.1:\d+\/(?:\?t=\S+)?/);
        if (match?.[0]) {
          clearTimeout(timeout);
          resolve(match[0]);
        }
      });
    });
    return { url, stop: () => stop(child) };
  } catch (error) {
    await stop(child);
    throw error;
  }
}
