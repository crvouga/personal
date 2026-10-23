// Child-process helpers. Output is streamed to the terminal unless captured,
// and secrets only ever travel in the `env` option, never in argv.
export type RunOptions = {
  cwd?: string;
  env?: Record<string, string>;
  capture?: boolean;
  quiet?: boolean;
};
export type RunResult = { code: number; stdout: string };

export async function run(
  cmd: string[],
  options: RunOptions = {}
): Promise<RunResult> {
  const child = Bun.spawn({
    cmd,
    cwd: options.cwd,
    env: { ...process.env, ...options.env },
    stdin: options.capture ? 'ignore' : 'inherit',
    stdout: options.capture ? 'pipe' : 'inherit',
    stderr: options.quiet ? 'ignore' : 'inherit',
  });
  const stdout = options.capture
    ? await new Response(child.stdout as ReadableStream).text()
    : '';
  return { code: await child.exited, stdout };
}

export async function capture(
  cmd: string[],
  options: RunOptions = {}
): Promise<string | undefined> {
  try {
    const { code, stdout } = await run(cmd, {
      ...options,
      capture: true,
      quiet: true,
    });
    return code === 0 ? stdout.trim() : undefined;
  } catch {
    return undefined;
  }
}
