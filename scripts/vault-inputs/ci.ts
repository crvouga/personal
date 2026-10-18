// Re-runs the failed jobs of the latest failed CI run on main, after confirmation.
import { confirm } from './prompt';
import { capture, run } from './process';

export async function rerunFailedCi(infraRepo: string): Promise<void> {
  const out = await capture([
    'gh',
    'run',
    'list',
    '--repo',
    infraRepo,
    '--workflow',
    'ci.yml',
    '--branch',
    'main',
    '--limit',
    '1',
    '--json',
    'databaseId,conclusion,displayTitle',
  ]);
  const latest = out ? JSON.parse(out)[0] : undefined;
  if (!latest || latest.conclusion !== 'failure') {
    console.log('Latest CI run on main is not failed; nothing to re-run.');
    return;
  }
  if (!(await confirm(`Re-run failed jobs of "${latest.displayTitle}"?`)))
    return;
  const id = String(latest.databaseId);
  await run(['gh', 'run', 'rerun', id, '--repo', infraRepo, '--failed']);
  if (await confirm('Watch it until it finishes?'))
    await run(['gh', 'run', 'watch', id, '--repo', infraRepo, '--exit-status']);
}
