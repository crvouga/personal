/** Used by both OS bootstraps, ws tools sync and ws update. No workspace dependencies. */
import { spawnSync } from 'node:child_process';
import {
  assertManagedConfig,
  globalConfigDir,
  publishGlobalConfig,
  workspaceRoot,
} from './global-config';
import { configureShellPath } from './shell-path';

function run(args: string[]): void {
  const result = spawnSync(args[0]!, args.slice(1), {
    cwd: workspaceRoot,
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(`${args.join(' ')} failed (${result.status})`);
}

export function syncTools(): void {
  const dir = globalConfigDir();
  assertManagedConfig(dir);
  run(['mise', 'install', '--locked']);
  publishGlobalConfig(dir);
  run(['mise', 'reshim']);
  configureShellPath();
}

if (import.meta.main) {
  syncTools();
  if (!process.argv.includes('--tools-only')) {
    run([
      'mise',
      'exec',
      '--locked',
      '--',
      'bun',
      'install',
      '--frozen-lockfile',
    ]);
  }
  console.log(
    'Shared toolchain installed globally. Configure your shell as documented in scripts/dev/README.md.'
  );
  console.log(
    'Verify: mise exec -- bun scripts/dev/doctor.ts (add --docker to require a running Docker engine).'
  );
}
