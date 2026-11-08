import { runAnsible } from './ansible';
import { desired } from '../../../../personal-cli/src/t3/desired';
import policy from '../../../ubuntu/t3/policy.json';
import { basename, dirname, join, resolve } from 'node:path';
import { rename, rm, symlink } from 'node:fs/promises';
import type { Runner, Check } from '../../../../fleet/src/types';

export async function stageT3Policy(
  root: string,
  executable: string,
  run: Runner,
  node: string
): Promise<Check> {
  const instances = await desired(
    resolve(root, 'packages/workstation/agents/t3.json'),
    await stableWorkspace(root),
    node
  );
  const document = {
    ...policy,
    settings: Object.fromEntries(
      Object.entries(instances).map(([id, value]) => [
        `providerInstances.${id}`,
        { value, locked: true },
      ])
    ),
  };
  const result = await runAnsible(run, 't3-policy.yml', {
    cwd: resolve(root, 'packages/workstation/ubuntu'),
    input: JSON.stringify({
      t3_executable: executable,
      t3_policy_document: document,
    }),
    timeoutMs: 120_000,
  });
  return {
    id: 't3:policy-staged',
    status: result.ok ? 'pass' : 'fail',
    summary: result.ok
      ? 'Native T3 policy validated and staged; runtime activation is checked separately.'
      : 'T3_POLICY_STAGE_FAILED',
    remedy: {
      action:
        'Review any existing administrator policy and the pinned native validation result. No live settings database or user state is overwritten.',
    },
  };
}
export async function verifyT3Policy(
  executable: string,
  run: Runner,
  pause: () => Promise<void> = () =>
    new Promise((done) => setTimeout(done, 1000))
): Promise<Check> {
  // A newly started native server can be active before loading its policy.
  // Bound read-only startup observation; never restart to make this check pass.
  let loaded = false;
  for (let attempt = 0; attempt < 6; attempt++) {
    const result = await run([executable, 'policy', 'show'], {
      timeoutMs: 5000,
    });
    loaded = result.ok && /loaded this policy\.\s*$/.test(result.stdout);
    if (loaded) break;
    if (attempt < 5) await pause();
  }
  return {
    id: 't3:policy-loaded',
    status: loaded ? 'pass' : 'fail',
    summary: loaded
      ? 'Running T3 server confirms it loaded the installed managed policy.'
      : 'T3_POLICY_RESTART_PENDING',
    remedy: {
      action:
        'During approved maintenance restart the native T3 service, then rerun fleet-sync. Routine sync preserves active turns.',
    },
  };
}

/** Fleet revisions live at .../fleet/revisions/<sha>. Point .../fleet/current at
 * the applied revision and reference it from the policy, so the policy (and the
 * T3 restart it needs) changes only when provider settings change, not on every
 * new commit. Other checkouts are used as-is.
 */
export async function stableWorkspace(root: string): Promise<string> {
  const revisions = dirname(resolve(root));
  if (basename(revisions) !== 'revisions') return root;
  const current = join(dirname(revisions), 'current');
  const staged = `${current}.${process.pid}`;
  await rm(staged, { force: true });
  await symlink(join('revisions', basename(resolve(root))), staged);
  await rename(staged, current);
  return current;
}
