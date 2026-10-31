import { spawnSync } from 'node:child_process';
import { checkMachine } from '../../../../scripts/dev/doctor';
import { workspaceRoot } from '../lib/paths';
import type { GlobalOpts } from '../lib/cli-opts';
import { printJson } from '../lib/output-and-theme';

export function cmdToolsSync(opts: GlobalOpts): void {
  const result = spawnSync(
    'mise',
    [
      'exec',
      '--locked',
      'bun',
      '--',
      'bun',
      'scripts/dev/setup.ts',
      '--tools-only',
      ...(opts.nonInteractive ? ['--non-interactive'] : []),
    ],
    {
      cwd: workspaceRoot(),
      encoding: 'utf8',
      stdio: opts.json ? 'pipe' : 'inherit',
    }
  );
  if (result.status !== 0)
    throw new Error(
      result.stderr?.trim() ||
        'Toolchain sync failed. See scripts/dev/README.md.'
    );
  if (opts.json) printJson({ ok: true, synced: true });
}

export function cmdToolsCheck(opts: GlobalOpts & { docker?: boolean }): void {
  const checks = checkMachine(opts.docker === true);
  const ok = checks.every((check) => check.status !== 'fail');
  if (opts.json) printJson({ ok, checks });
  else
    for (const check of checks)
      console.log(`${check.status.toUpperCase()} ${check.id}: ${check.detail}`);
  if (!ok) process.exitCode = 1;
}
