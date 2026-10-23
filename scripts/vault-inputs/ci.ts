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
  fromVault: string[] = [],
  execute: typeof run = run
): Promise<boolean> {
  // This API version returns the dispatched ID, avoiding races with health/update runs.
  const dispatched = await execute(
    [
      'gh',
      'api',
      `repos/${infraRepo}/actions/workflows/${VAULT_FIX_WORKFLOW}/dispatches`,
      '--method',
      'POST',
      '-H',
      'X-GitHub-Api-Version: 2026-03-10',
      '-f',
      'ref=main',
      '-f',
      'inputs[task]=vault-inputs',
      ...(fromVault.length
        ? ['-f', `inputs[from_vault]=${fromVault.join(',')}`]
        : []),
    ],
    { capture: true }
  );
  if (dispatched.code !== 0) return false;
  let id: unknown;
  try {
    id = JSON.parse(dispatched.stdout).workflow_run_id;
  } catch {
    return false;
  }
  if (typeof id !== 'number' || !Number.isSafeInteger(id) || id <= 0)
    return false;
  const watched = await execute([
    'gh',
    'run',
    'watch',
    String(id),
    '--repo',
    infraRepo,
    '--exit-status',
  ]);
  return watched.code === 0;
}
