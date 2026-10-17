const active = new Set<Bun.Subprocess>();
let cancelled = false;

function assertActive(duringShutdown?: boolean): void {
  if (cancelled && !duringShutdown)
    throw new Error('Development startup cancelled');
}

export async function cancelCommands(): Promise<void> {
  cancelled = true;
  await Promise.all(
    [...active].map(async (child) => {
      child.kill('SIGTERM');
      const deadline = setTimeout(() => child.kill('SIGKILL'), 5000);
      try {
        await child.exited;
      } finally {
        clearTimeout(deadline);
      }
    })
  );
}

export async function command(
  args: string[],
  env: NodeJS.ProcessEnv,
  capture = false,
  options: { timeoutMs?: number; duringShutdown?: boolean } = {}
): Promise<string> {
  assertActive(options.duringShutdown);
  const child = Bun.spawn(args, {
    env,
    stdin: 'ignore',
    stdout: capture ? 'pipe' : 'inherit',
    stderr: 'inherit',
  });
  active.add(child);
  const output = capture
    ? new Response(child.stdout).text()
    : Promise.resolve('');
  try {
    const [status, text] = await completed(child, output, {
      label: `${args[0]} ${args[1] ?? ''}`,
      timeoutMs: options.timeoutMs ?? 240000,
    });
    assertActive(options.duringShutdown);
    if (status !== 0)
      throw new Error(
        `${args[0]} ${args[1] ?? ''} failed (${status}); see the task log above`
      );
    return text;
  } finally {
    active.delete(child);
  }
}
async function completed(
  child: Bun.Subprocess,
  output: Promise<string>,
  options: { label: string; timeoutMs: number }
): Promise<[number, string]> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(
        new Error(`${options.label} timed out after ${options.timeoutMs}ms`)
      );
    }, options.timeoutMs);
  });
  try {
    return await Promise.race([Promise.all([child.exited, output]), timeout]);
  } finally {
    clearTimeout(timer);
  }
}
export async function waitFor(url: string): Promise<void> {
  const deadline = Date.now() + 240000;
  while (Date.now() < deadline) {
    if (cancelled) throw new Error('Development startup cancelled');
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (response.ok) return;
    } catch {
      /* Starting a local dependency can take a few seconds. */
    }
    await Bun.sleep(1000);
  }
  throw new Error(`Local dependency did not become ready: ${url}`);
}
