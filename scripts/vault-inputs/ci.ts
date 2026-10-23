// Re-runs the failed jobs of the latest failed CI run on main, after confirmation.
import { confirm } from './prompt';
import { capture, run } from './process';

export async function rerunFailedCi(
  infraRepo: string,
  workflow: 'ci.yml' | 'deploy.yml' = 'ci.yml'
): Promise<void> {
  const out = await capture([
    'gh',
    'run',
    'list',
    '--repo',
    infraRepo,
    '--workflow',
    workflow,
    ...(workflow === 'ci.yml' ? ['--event', 'push'] : []),
    '--branch',
    'main',
    '--limit',
    '1',
    '--json',
    'databaseId,conclusion,displayTitle',
  ]);
  const latest = out ? JSON.parse(out)[0] : undefined;
  if (!latest || latest.conclusion !== 'failure') {
    console.log(
      `Latest ${workflow} run on main is not failed; nothing to re-run.`
    );
    return;
  }
  if (!(await confirm(`Re-run failed jobs of "${latest.displayTitle}"?`)))
    return;
  const id = String(latest.databaseId);
  await run(['gh', 'run', 'rerun', id, '--repo', infraRepo, '--failed']);
  if (await confirm('Watch it until it finishes?'))
    await run(['gh', 'run', 'watch', id, '--repo', infraRepo, '--exit-status']);
}

export const VAULT_FIX_WORKFLOW = 'maintenance.yml';

/**
 * Dispatches the repair workflow, which sees the repo secrets that no API will
 * return, and waits for it. Resolves false when it could not be dispatched or
 * did not succeed, so the caller can fall back to the interactive flow.
 */
export async function repairInActions(
  infraRepo: string,
  fromVault: string[] = []
): Promise<boolean> {
  const started = Date.now();
  const dispatched = await run([
    'gh',
    'workflow',
    'run',
    VAULT_FIX_WORKFLOW,
    '--repo',
    infraRepo,
    '--ref',
    'main',
    '-f',
    'task=vault-inputs',
    ...(fromVault.length ? ['-f', `from_vault=${fromVault.join(',')}`] : []),
  ]);
  if (dispatched.code !== 0) return false;
  for (let attempt = 0; attempt < 12; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 5000));
    const out = await capture([
      'gh',
      'run',
      'list',
      '--repo',
      infraRepo,
      '--workflow',
      VAULT_FIX_WORKFLOW,
      '--limit',
      '1',
      '--json',
      'databaseId,createdAt',
    ]);
    const latest = out ? JSON.parse(out)[0] : undefined;
    if (latest && Date.parse(latest.createdAt) >= started - 10_000) {
      const watched = await run([
        'gh',
        'run',
        'watch',
        String(latest.databaseId),
        '--repo',
        infraRepo,
        '--exit-status',
      ]);
      return watched.code === 0;
    }
  }
  return false;
}
