import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const ATLAS_PLAN_TIMEOUT = 'Workspace Atlas planning read timed out';

// The pinned provider has no inspection timeout. Only its read-only commands
// get a deadline; a real schema apply must never be killed or replayed here.
export async function runAtlas(
  binary: string,
  args: string[],
  timeoutMs = 120_000
): Promise<number> {
  const readOnly =
    args[0] === 'schema' &&
    (args[1] === 'inspect' ||
      (['apply', 'clean'].includes(args[1]) &&
        args.includes('--dry-run') &&
        !args.some((arg) => arg.startsWith('--dry-run='))));
  const child = Bun.spawn([binary, ...args], {
    stdin: 'inherit',
    stdout: 'inherit',
    stderr: 'inherit',
  });
  let timedOut = false;
  const timer = readOnly
    ? setTimeout(() => {
        timedOut = true;
        child.kill('SIGKILL');
      }, timeoutMs)
    : undefined;
  try {
    const code = await child.exited;
    if (!timedOut) return code;
    console.error(`${ATLAS_PLAN_TIMEOUT} after ${timeoutMs / 1000}s.`);
    return 124;
  } finally {
    clearTimeout(timer);
  }
}

export function atlasPlanEnvironment(env = process.env) {
  const binary = Bun.which('atlas', { PATH: env.PATH });
  if (!binary) return { env, cleanup: () => {} };
  const directory = mkdtempSync(join(tmpdir(), 'workspace-atlas-plan-'));
  const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
  writeFileSync(
    join(directory, 'atlas'),
    `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(import.meta.path)} "$@"\n`,
    { mode: 0o700 }
  );
  return {
    env: {
      ...env,
      PATH: `${directory}:${env.PATH ?? ''}`,
      WORKSPACE_ATLAS_BINARY: binary,
    },
    cleanup: () => rmSync(directory, { recursive: true, force: true }),
  };
}

if (import.meta.main) {
  const binary = process.env.WORKSPACE_ATLAS_BINARY;
  if (!binary) throw new Error('WORKSPACE_ATLAS_BINARY is required');
  process.exitCode = await runAtlas(binary, process.argv.slice(2));
}
