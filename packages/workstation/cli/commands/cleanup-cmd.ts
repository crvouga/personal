import type { Command } from 'commander';

import type { GlobalOpts } from '../lib/cli-opts';
import { confirmOrThrow } from '../lib/cli-opts';
import {
  planCleanup,
  type CleanupGroup,
  type CleanupPlan,
} from '../lib/cleanup/plan';
import { terminateProcesses } from '../lib/cleanup/terminate';
import { currentPlatform } from '../../../fleet/src/platform';
import type { ProcessInfo } from '../../../fleet/src/platform/types';
import {
  muted,
  printFail,
  printJson,
  printOk,
  printWarn,
  resolveOutputMode,
  section,
  warn as warnColor,
} from '../lib/output-and-theme';

export type CleanupCmdOpts = GlobalOpts & {
  dryRun?: boolean | undefined;
  includeTools?: boolean | undefined;
  protect?: readonly string[] | undefined;
  grace?: string | undefined;
};

const DEFAULT_GRACE_SECONDS = 3;
const KIB_PER_MIB = 1024;
const MIB_PER_GIB = 1024;

function formatMemory(kb: number): string {
  const mib = kb / KIB_PER_MIB;
  if (mib >= MIB_PER_GIB) return `${(mib / MIB_PER_GIB).toFixed(1)} GB`;
  return `${Math.round(mib)} MB`;
}

function totalRss(groups: readonly CleanupGroup[]): number {
  return groups.reduce((sum, g) => sum + g.rssKb, 0);
}

function totalPids(groups: readonly CleanupGroup[]): number {
  return groups.reduce((sum, g) => sum + g.pids.length, 0);
}

function groupLine(g: CleanupGroup, width: number): string {
  const head = `${g.kind.padEnd(7)} ${g.reason.padEnd(6)} ${String(g.root.pid).padStart(6)} ×${String(g.pids.length).padEnd(3)} ${formatMemory(g.rssKb).padStart(8)} ${`${Math.round(g.cpu)}%`.padStart(5)}`;
  const room = Math.max(20, width - head.length - 4);
  const cmd =
    g.root.command.length > room
      ? `${g.root.command.slice(0, room - 1)}…`
      : g.root.command;
  return `  ${head}  ${muted(cmd)}`;
}

function printPlan(plan: CleanupPlan): void {
  const width = process.stdout.columns ?? 120;
  section(
    'Cleanup',
    `${plan.targets.length} tree(s) · ${totalPids(plan.targets)} process(es) · ~${formatMemory(totalRss(plan.targets))}`
  );
  if (plan.targets.length > 0) {
    console.log(
      muted('  kind    owner     pid  procs   memory   cpu  command')
    );
  }
  for (const g of plan.targets) console.log(groupLine(g, width));
  if (plan.kept.length > 0) {
    console.log(
      `  ${warnColor('!')} kept ${plan.kept.length} agent/editor tool tree(s) (~${formatMemory(totalRss(plan.kept))}) ${muted('— pass --include-tools to kill them too')}`
    );
  }
}

function jsonGroup(g: CleanupGroup): Record<string, unknown> {
  return {
    pid: g.root.pid,
    kind: g.kind,
    reason: g.reason,
    processes: g.pids.length,
    rssKb: g.rssKb,
    cpu: g.cpu,
    command: g.root.command,
  };
}

function parseGrace(raw: string | undefined): number {
  const seconds = raw === undefined ? DEFAULT_GRACE_SECONDS : Number(raw);
  if (!Number.isFinite(seconds) || seconds < 0) {
    throw new Error(`--grace must be a non-negative number, got ${raw}`);
  }
  return seconds * 1000;
}

function buildPlan(snapshot: ProcessInfo[], opts: CleanupCmdOpts): CleanupPlan {
  return planCleanup(snapshot, {
    selfPid: process.pid,
    uid: process.getuid?.() ?? -1,
    includeTools: opts.includeTools === true,
    protect: (opts.protect ?? []).map((p) => new RegExp(p, 'i')),
  });
}

function selfAndAncestors(snapshot: readonly ProcessInfo[]): Set<number> {
  const byPid = new Map(snapshot.map((p) => [p.pid, p]));
  const out = new Set<number>([0, 1]);
  for (let p = byPid.get(process.pid); p !== undefined && !out.has(p.pid);) {
    out.add(p.pid);
    p = byPid.get(p.ppid);
  }
  out.add(process.pid);
  return out;
}

export async function cmdCleanup(opts: CleanupCmdOpts): Promise<void> {
  const mode = resolveOutputMode(opts.json);
  const graceMs = parseGrace(opts.grace);
  const platform = currentPlatform();
  const snapshot = platform.listProcesses();
  if (snapshot === null) {
    const detail = `process cleanup is unsupported on ${platform.label}`;
    if (mode === 'json') printJson({ ok: false, error: detail });
    else printFail(detail);
    process.exitCode = 1;
    return;
  }
  const plan = buildPlan(snapshot, opts);
  if (mode === 'human') printPlan(plan);
  if (plan.targets.length === 0 || opts.dryRun === true) {
    if (mode === 'json') {
      printJson({
        ok: true,
        dryRun: opts.dryRun === true,
        targets: plan.targets.map(jsonGroup),
        kept: plan.kept.map(jsonGroup),
      });
    } else if (plan.targets.length === 0) printOk('Nothing to clean up');
    return;
  }
  await confirmOrThrow(
    `Kill ${totalPids(plan.targets)} process(es)?`,
    'SIGTERM, then SIGKILL after the grace period',
    opts
  );
  await runTermination(plan, { mode, graceMs, snapshot });
}

async function runTermination(
  plan: CleanupPlan,
  ctx: { mode: 'human' | 'json'; graceMs: number; snapshot: ProcessInfo[] }
): Promise<void> {
  const platform = currentPlatform();
  const report = await terminateProcesses(
    plan.targets.flatMap((g) => g.pids),
    {
      graceMs: ctx.graceMs,
      list: () => platform.listProcesses(),
      forbidden: selfAndAncestors(ctx.snapshot),
    }
  );
  const freed = formatMemory(totalRss(plan.targets));
  if (ctx.mode === 'json') {
    printJson({
      ok: report.survivors.length === 0,
      targets: plan.targets.map(jsonGroup),
      kept: plan.kept.map(jsonGroup),
      ...report,
      freedRssKb: totalRss(plan.targets),
    });
  } else {
    const forced =
      report.forced.length > 0
        ? ` (${report.forced.length} needed SIGKILL)`
        : '';
    printOk(
      `Killed ${report.signalled.length} process(es), freed ~${freed}${forced}`
    );
    if (report.survivors.length > 0) {
      printWarn(`Still running: ${report.survivors.join(', ')}`);
    }
  }
  if (report.survivors.length > 0) process.exitCode = 1;
}

/** `personal workstation cleanup` — registered from `program.ts` (kept here for file-size limits). */
export function registerCleanup(
  program: Command,
  globals: () => GlobalOpts
): void {
  program
    .command('cleanup')
    .description(
      '[ws] Kill leaked dev processes (tests, dev servers, builds, headless browsers)'
    )
    .option('--dry-run', 'List what would be killed without killing')
    .option(
      '--include-tools',
      'Also kill MCP/language servers owned by live agents/editors'
    )
    .option(
      '--protect <pattern...>',
      'Regex (case-insensitive) of commands to never kill, with their children'
    )
    .option('--grace <seconds>', 'SIGTERM grace period before SIGKILL', '3')
    .action(
      async (opts: {
        dryRun?: boolean | undefined;
        includeTools?: boolean | undefined;
        protect?: string[] | undefined;
        grace?: string | undefined;
      }) => cmdCleanup({ ...globals(), ...opts })
    );
}
