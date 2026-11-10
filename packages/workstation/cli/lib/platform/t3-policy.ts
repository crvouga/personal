import { runAnsible } from './ansible';
import { desired } from '../../../../personal-cli/src/t3/desired';
import policy from '../../../ubuntu/t3/policy.json';
import { basename, dirname, join, resolve } from 'node:path';
import { rename, rm, stat, symlink } from 'node:fs/promises';
import { homedir } from 'node:os';
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
        'During approved maintenance restart the native T3 service, then rerun fleet-sync. Routine sync preserves active turns.',
    },
  };
}

/** T3 streams every active turn into its state database, so a database
 * unchanged for this long means no turn is running.
 */
export const T3_IDLE_MS = 5 * 60_000;
/** Summary of a heal that restarted T3: its manager link reconnects next. */
export const T3_RESTARTED_SUMMARY =
  'T3 was idle, so it was restarted to load the new managed policy; the running server confirms it.';

/** Newest write to T3's state database (0 when absent). */
export async function lastT3Write(
  stateDir = join(homedir(), '.t3', 'userdata')
): Promise<number> {
  let newest = 0;
  for (const name of ['statev2.sqlite', 'statev2.sqlite-wal']) {
    const info = await stat(join(stateDir, name)).catch(() => null);
    if (info) newest = Math.max(newest, info.mtimeMs);
  }
  return newest;
}

/** Self-healing: a staged policy the running T3 has not loaded is applied by
 * restarting the desktop app, but only while T3 is idle, so routine sync never
 * ends an active turn. While busy it is reported (non-blocking) and the next
 * sync applies it.
 */
export async function healT3Policy(
  executable: string,
  run: Runner,
  options: {
    lastWrite?: number;
    now?: number;
    pause?: () => Promise<void>;
  } = {}
): Promise<Check> {
  // Measure idleness before any probe below could touch T3's state.
  const lastWrite = options.lastWrite ?? (await lastT3Write());
  const check = await verifyT3Policy(executable, run, options.pause);
  if (check.status === 'pass') return check;
  if ((options.now ?? Date.now()) - lastWrite < T3_IDLE_MS)
    return {
      id: 't3:policy-loaded',
      status: 'warn',
      summary: 'T3_POLICY_PENDING_ACTIVE',
      remedy: {
        action:
          'T3 has active work, so the new provider settings wait: the next fleet-sync applies them once T3 has been idle for five minutes. To apply now (this restarts T3 and ends its active turns): personal fleet-sync --maintenance',
      },
    };
  await run(['systemctl', '--user', 'restart', T3_DESKTOP_UNIT], {
    timeoutMs: 60_000,
  });
  // The desktop app takes a few seconds to come back with its server.
  const after = await verifyT3Policy(
    executable,
    run,
    options.pause ?? (() => new Promise((done) => setTimeout(done, 5000)))
  );
  return after.status === 'pass'
    ? {
        ...after,
        summary: T3_RESTARTED_SUMMARY,
      }
    : { ...after, summary: 'T3_POLICY_RESTART_FAILED' };
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
