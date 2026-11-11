/** Used by both OS bootstraps, personal workstation tools sync and personal workstation update. No workspace dependencies. */
import { spawnSync } from 'node:child_process';
import {
  assertManagedConfig,
  globalConfigDir,
  publishGlobalConfig,
  workspaceRoot,
} from './global-config';
import { configureShellPath } from './shell-path';
import { installNativeAws } from './native-aws';

function run(args: string[]): void {
  const result = spawnSync(args[0]!, args.slice(1), {
    cwd: workspaceRoot,
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(`${args.join(' ')} failed (${result.status})`);
}

/** Resolves to false when dev-fleet owns this machine's global config. */
export async function syncTools(): Promise<boolean> {
  const dir = globalConfigDir();
  assertManagedConfig(dir);
  run(['mise', 'install', '--locked']);
  await installNativeAws();
  const published = publishGlobalConfig(dir);
  run(['mise', 'reshim']);
  configureShellPath();
  return published;
}

if (import.meta.main) {
  const published = await syncTools();
  if (!process.argv.includes('--tools-only'))
    run([
      'mise',
      'exec',
      '--locked',
      '--',
      'bun',
      'install',
      '--frozen-lockfile',
    ]);
  console.log(
    published
      ? 'Shared toolchain installed globally. Reopen terminals/editors, or refresh this terminal with: exec "$SHELL" -l (Unix).'
      : 'Shared toolchain installed for this checkout. The global mise config is the one dev-fleet published on this fleet machine and was left unchanged.'
  );
  console.log(
    'Verify: mise exec -- bun scripts/dev/doctor.ts (add --docker to require a running Docker engine).'
  );
}
