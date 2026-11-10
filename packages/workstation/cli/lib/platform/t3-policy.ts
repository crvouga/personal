import { runAnsible } from './ansible';
import { desired } from '../../../../personal-cli/src/t3/desired';
import policy from '../../../ubuntu/t3/policy.json';
import { basename, dirname, join, resolve } from 'node:path';
import { rename, rm, symlink } from 'node:fs/promises';
import { T3_DESKTOP_UNIT } from './t3-service';
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
        'T3 did not load the installed policy after a restart. Inspect systemctl --user status t3code-desktop.service on the node, then rerun fleet-sync.',
    },
  };
}

/** Summary of a heal that restarted T3: its manager link reconnects next. */
export const T3_RESTARTED_SUMMARY =
  'T3 was restarted to load the new managed policy; the running server confirms it.';

/** A staged policy the running T3 has not loaded is applied by restarting the
 * desktop app, so every node offers the same providers after every sync. This
 * ends the turns that T3 is running; fleet-sync never waits for it to be idle.
 */
export async function healT3Policy(
  executable: string,
  run: Runner,
  pause?: () => Promise<void>
): Promise<Check> {
  const check = await verifyT3Policy(executable, run, pause);
  if (check.status === 'pass') return check;
  await run(['systemctl', '--user', 'restart', T3_DESKTOP_UNIT], {
    timeoutMs: 60_000,
  });
  // The desktop app takes a few seconds to come back with its server.
  const after = await verifyT3Policy(
    executable,
    run,
    pause ?? (() => new Promise((done) => setTimeout(done, 5000)))
  );
  return after.status === 'pass'
    ? {
        ...after,
        summary: T3_RESTARTED_SUMMARY,
      }
    : { ...after, summary: 'T3_POLICY_RESTART_FAILED' };
}

/** Fleet revisions live at .../fleet/revisions/<sha> (workers) or
 * .../fleet/manager-runs/<sha> (the manager). Point .../fleet/current at the
 * applied revision and reference it from T3, so provider settings (and the T3
 * restart a policy needs) change only when they really change, not on every
 * new commit, and never name a checkout that is later pruned. Other checkouts
 * are used as-is.
 */
export async function stableWorkspace(root: string): Promise<string> {
  const current = stablePath(root);
  if (current === root) return root;
  const revisions = dirname(resolve(root));
  const staged = `${current}.${process.pid}`;
  await rm(staged, { force: true });
  await symlink(join(basename(revisions), basename(resolve(root))), staged);
  await rename(staged, current);
  return current;
}

/** Where `stableWorkspace` points for this checkout, without moving it. */
export function stablePath(root: string): string {
  const revisions = dirname(resolve(root));
  return ['revisions', 'manager-runs'].includes(basename(revisions))
    ? join(dirname(revisions), 'current')
    : root;
}
