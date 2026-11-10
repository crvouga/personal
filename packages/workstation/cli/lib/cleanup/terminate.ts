import type { ProcessInfo } from '../../../../fleet/src/platform/types';

/**
 * Kill process trees without letting them respawn:
 *
 *   1. SIGSTOP every target (freezes supervisors/watchers mid-fork)
 *   2. re-scan until no new children of a frozen target appear; freeze those
 *   3. SIGTERM + SIGCONT everything at once (graceful shutdown in parallel)
 *   4. poll until all exit or the grace period ends, then SIGKILL survivors
 */

export type TerminateOptions = {
  readonly graceMs: number;
  /** Fresh process-table snapshot (for catching forks + final verification). */
  readonly list: () => ProcessInfo[] | null;
  /** PIDs that must never be signalled (init, this CLI, its ancestors). */
  readonly forbidden: ReadonlySet<number>;
};

export type TerminateReport = {
  /** Every PID signalled (initial targets + children caught mid-fork). */
  readonly signalled: readonly number[];
  /** Still alive after SIGTERM's grace period, so they got SIGKILL. */
  readonly forced: readonly number[];
  /** Still present (non-zombie) after SIGKILL — usually a permission issue. */
  readonly survivors: readonly number[];
};

const POLL_MS = 50;
const KILL_WAIT_MS = 1000;
const MAX_FORK_SCANS = 5;

function send(pids: Iterable<number>, signal: NodeJS.Signals): void {
  for (const pid of pids) {
    try {
      process.kill(pid, signal);
    } catch {
      // ESRCH: already gone. EPERM: not ours — reported as a survivor.
    }
  }
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

async function waitForExit(
  pids: readonly number[],
  ms: number
): Promise<number[]> {
  const deadline = Date.now() + ms;
  let alive = pids.filter(isAlive);
  while (alive.length > 0 && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    alive = alive.filter(isAlive);
  }
  return alive;
}

/** Freeze children forked between the plan snapshot and the SIGSTOP. */
function freezeNewChildren(targets: Set<number>, opts: TerminateOptions): void {
  for (let scan = 0; scan < MAX_FORK_SCANS; scan++) {
    const fresh = (opts.list() ?? []).filter(
      (p) =>
        targets.has(p.ppid) && !targets.has(p.pid) && !opts.forbidden.has(p.pid)
    );
    if (fresh.length === 0) return;
    for (const p of fresh) targets.add(p.pid);
    send(
      fresh.map((p) => p.pid),
      'SIGSTOP'
    );
  }
}

export async function terminateProcesses(
  pids: readonly number[],
  opts: TerminateOptions
): Promise<TerminateReport> {
  const targets = new Set(pids.filter((pid) => !opts.forbidden.has(pid)));
  if (targets.size !== pids.length) {
    throw new Error('refusing to signal a forbidden pid');
  }
  send(targets, 'SIGSTOP');
  freezeNewChildren(targets, opts);
  send(targets, 'SIGTERM');
  send(targets, 'SIGCONT');
  const forced = await waitForExit([...targets], opts.graceMs);
  send(forced, 'SIGKILL');
  const lingering = await waitForExit(forced, KILL_WAIT_MS);
  // Zombies still answer kill(pid, 0) until reaped; they hold no resources.
  const zombies = new Set(
    (lingering.length === 0 ? [] : (opts.list() ?? []))
      .filter((p) => p.state.startsWith('Z'))
      .map((p) => p.pid)
  );
  return {
    signalled: [...targets],
    forced,
    survivors: lingering.filter((pid) => !zombies.has(pid)),
  };
}
