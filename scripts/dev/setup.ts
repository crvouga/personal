/** Used by both OS bootstraps, personal workstation tools sync and personal workstation update. No workspace dependencies. */
import { setupStatus, setupFailureCode, type SetupPhase } from './setup-status';
import { spawnSync } from 'node:child_process';
import {
  assertManagedConfig,
  globalConfigDir,
  publishGlobalConfig,
  workspaceRoot,
} from './global-config';
import { configureShellPath } from './shell-path';
import { installNativeAws } from './native-aws';
import { installNativeT3 } from './native-t3';

function run(args: string[]): void {
  const result = spawnSync(args[0]!, args.slice(1), {
    cwd: workspaceRoot,
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(`${args.join(' ')} failed (${result.status})`);
}

export async function syncTools(
  observe: (phase: SetupPhase) => void = () => {}
): Promise<void> {
  observe('managed-config');
  const dir = globalConfigDir();
  assertManagedConfig(dir);
  observe('mise');
  run(['mise', 'install', '--locked']);
  observe('aws');
  await installNativeAws();
  observe('t3');
  await installNativeT3();
  observe('global-config');
  publishGlobalConfig(dir);
  run(['mise', 'reshim']);
  observe('shell');
  configureShellPath();
}

if (import.meta.main) {
  const flag = process.argv.indexOf('--status-file');
  const report = setupStatus(flag < 0 ? undefined : process.argv[flag + 1]);
  let phase: SetupPhase = 'managed-config';
  try {
    await syncTools((current) => {
      phase = current;
      report(phase, 'running');
    });
    if (!process.argv.includes('--tools-only')) {
      phase = 'dependencies';
      report(phase, 'running');
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
    report(phase, 'passed');
  } catch (error) {
    report(phase, 'failed', setupFailureCode(error));
    throw new Error(
      `Shared toolchain phase ${phase} failed; inspect the declared installer prerequisites and retry.`
    );
  }
  console.log(
    'Shared toolchain installed globally. Reopen terminals/editors, or refresh this terminal with: exec "$SHELL" -l (Unix).'
  );
  console.log(
    'Verify: mise exec -- bun scripts/dev/doctor.ts (add --docker to require a running Docker engine).'
  );
}
