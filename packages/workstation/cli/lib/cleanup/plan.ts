import type { ProcessInfo } from '../../../../fleet/src/platform/types';

/**
 * Pure planner for `personal workstation cleanup`: turns one process-table snapshot into the
 * process trees that should be killed.
 *
 * A "group" is a dev process tree rooted at its topmost dev ancestor
 * (climbing through `sh -c` wrappers). What happens to a group depends on
 * who owns the root:
 *
 *   orphan  parent is init/launchd — leaked (e.g. a `bun dev &` whose shell
 *           exited). Always killed.
 *   shell   started from a terminal or an agent's shell tool (tests, dev
 *           servers, builds). Killed.
 *   tool    spawned directly by an agent CLI or GUI app (MCP servers,
 *           language servers). Kept unless `includeTools`, since killing
 *           them breaks the live session that owns them.
 *
 * Groups touching a protected process (this CLI's ancestors + pipeline, agent CLIs,
 * infrastructure like 9router/colima, user `--protect` patterns) are never
 * killed — not even their descendants.
 */

export type CleanupReason = 'orphan' | 'shell' | 'tool';
export type CleanupKind = 'browser' | 'test' | 'server' | 'build' | 'process';

export type CleanupGroup = {
  readonly root: ProcessInfo;
  readonly reason: CleanupReason;
  readonly kind: CleanupKind;
  /** Root + every descendant (any executable). */
  readonly pids: readonly number[];
  readonly rssKb: number;
  readonly cpu: number;
};

export type CleanupOptions = {
  readonly selfPid: number;
  readonly uid: number;
  readonly includeTools: boolean;
  /** Extra user patterns; matching processes + descendants are never killed. */
  readonly protect: readonly RegExp[];
};

export type CleanupPlan = {
  readonly targets: readonly CleanupGroup[];
  /** Tool groups left alone because `includeTools` was off. */
  readonly kept: readonly CleanupGroup[];
};

const DEV_EXE =
  /^(node|nodejs|bun|bunx|deno|npm|npx|pnpm|pnpx|yarn|corepack|tsx|ts-node|turbo|nx|esbuild|vite|vitest|jest|playwright|nodemon|next-server|next-router-worker|webpack|rollup|rspack|tsc|tsserver|workerd|wrangler|watchman|python[\d.]*|uv|uvicorn|gunicorn|ruby|rails|puma|bundle|java|gradle|mvn|go|cargo|rustc|php|air|beam\.smp|dotnet)$/;
/** Native binaries run out of dev build/cache dirs (esbuild, `go run`, …). */
const DEV_PATH = /\/node_modules\/|\/go-build\d+\/|\/target\/(debug|release)\//;
const TEST_BROWSER =
  /ms-playwright|Chrome for Testing|puppeteer|chromedriver|--headless/;
const APP_BUNDLE = /\.app\/Contents\//;
const SYSTEM_PATH = /^\/(System|usr\/libexec|usr\/sbin|sbin)\//;
const SHELL_EXE =
  /^-?(sh|bash|zsh|fish|dash|ksh|tcsh|csh|nu|login|tmux|screen)$/;
/** Agent CLIs: never killed; dev processes they spawn directly are tools. */
const AGENT =
  /(^|[\s/])(claude|opencode|codex|cursor-agent|gemini|aider|goose)(\s|$)|claude-code\/cli\.js/;
/** Local infrastructure other work depends on: never killed, nor its tree. */
const INFRA =
  /\b(9router|cloudflared|colima|limactl|docker|OpenCodeNotifier)\b/i;

const KIND_PATTERNS: ReadonlyArray<readonly [CleanupKind, RegExp]> = [
  ['browser', TEST_BROWSER],
  [
    'test',
    /(\s|\/|:)(test|tests|jest|vitest|mocha|ava)(\s|$|:)|--test-worker|playwright test/,
  ],
  [
    'server',
    /(\s|:)(dev|start|serve|server|preview)(\s|$)|server\.[cm]?[jt]s|next-server|vite|nodemon|wrangler|workerd|uvicorn|gunicorn|puma/,
  ],
  [
    'build',
    /\b(build|turbo|tsc|esbuild|webpack|rollup|lint|eslint|typecheck|check)\b/,
  ],
];

export function exeName(command: string): string {
  const first = command.split(/\s/, 1)[0] ?? '';
  return first.slice(first.lastIndexOf('/') + 1);
}

function isDevCommand(command: string): boolean {
  if (TEST_BROWSER.test(command)) return true;
  if (APP_BUNDLE.test(command) || SYSTEM_PATH.test(command)) return false;
  return DEV_EXE.test(exeName(command)) || DEV_PATH.test(command);
}

function isShell(p: ProcessInfo | undefined): boolean {
  return p !== undefined && SHELL_EXE.test(exeName(p.command));
}

type Table = {
  readonly byPid: ReadonlyMap<number, ProcessInfo>;
  readonly children: ReadonlyMap<number, readonly number[]>;
};

function buildTable(procs: readonly ProcessInfo[]): Table {
  const byPid = new Map<number, ProcessInfo>();
  const children = new Map<number, number[]>();
  for (const p of procs) {
    byPid.set(p.pid, p);
    if (p.pid === p.ppid) continue;
    const siblings = children.get(p.ppid);
    if (siblings === undefined) children.set(p.ppid, [p.pid]);
    else siblings.push(p.pid);
  }
  return { byPid, children };
}

/** `pid` and every descendant, breadth-first. */
export function descendants(
  children: ReadonlyMap<number, readonly number[]>,
  pid: number
): number[] {
  const out = [pid];
  const seen = new Set(out);
  for (let i = 0; i < out.length; i++) {
    for (const child of children.get(out[i] ?? -1) ?? []) {
      if (seen.has(child)) continue;
      seen.add(child);
      out.push(child);
    }
  }
  return out;
}

function ancestors(table: Table, pid: number): number[] {
  const out: number[] = [];
  let cur = table.byPid.get(pid);
  while (cur !== undefined && !out.includes(cur.pid)) {
    out.push(cur.pid);
    cur = cur.ppid > 0 ? table.byPid.get(cur.ppid) : undefined;
  }
  return out;
}

function protectedPids(table: Table, opts: CleanupOptions): Set<number> {
  const blocked = new Set<number>([0, 1, ...ancestors(table, opts.selfPid)]);
  // Our own pipeline/job (e.g. `personal workstation cleanup --json | jq`).
  const selfGroup = table.byPid.get(opts.selfPid)?.pgid;
  const infra = [INFRA, ...opts.protect];
  for (const p of table.byPid.values()) {
    if (p.uid !== opts.uid || p.pgid === selfGroup || AGENT.test(p.command)) {
      blocked.add(p.pid);
    }
    if (!infra.some((re) => re.test(p.command))) continue;
    for (const pid of descendants(table.children, p.pid)) blocked.add(pid);
  }
  return blocked;
}

function makeIsDev(
  table: Table,
  blocked: ReadonlySet<number>
): (pid: number) => boolean {
  return (pid) => {
    const p = table.byPid.get(pid);
    if (p === undefined || blocked.has(pid) || p.state.startsWith('Z')) {
      return false;
    }
    return isDevCommand(p.command);
  };
}

/** Next dev ancestor of `pid`: its dev parent, or dev grandparent via a shell. */
function devParent(
  table: Table,
  pid: number,
  isDev: (pid: number) => boolean
): number | null {
  const parent = table.byPid.get(table.byPid.get(pid)?.ppid ?? -1);
  if (parent === undefined) return null;
  if (isDev(parent.pid)) return parent.pid;
  return isShell(parent) && isDev(parent.ppid) ? parent.ppid : null;
}

/** Topmost dev ancestor, climbing through shell wrappers between dev processes. */
function rootOf(
  table: Table,
  pid: number,
  isDev: (pid: number) => boolean
): number {
  const seen = new Set<number>([pid]);
  let cur = pid;
  for (;;) {
    const next = devParent(table, cur, isDev);
    if (next === null || seen.has(next)) return cur;
    seen.add(next);
    cur = next;
  }
}

function reasonFor(table: Table, root: ProcessInfo): CleanupReason {
  const parent = table.byPid.get(root.ppid);
  if (root.ppid <= 1 || parent === undefined) return 'orphan';
  return isShell(parent) ? 'shell' : 'tool';
}

function kindFor(commands: readonly string[]): CleanupKind {
  for (const [kind, re] of KIND_PATTERNS) {
    if (commands.some((c) => re.test(c))) return kind;
  }
  return 'process';
}

function toGroup(table: Table, root: ProcessInfo): CleanupGroup {
  const pids = descendants(table.children, root.pid);
  const procs = pids.flatMap((pid) => table.byPid.get(pid) ?? []);
  return {
    root,
    reason: reasonFor(table, root),
    kind: kindFor(procs.map((p) => p.command)),
    pids,
    rssKb: procs.reduce((sum, p) => sum + p.rssKb, 0),
    cpu: procs.reduce((sum, p) => sum + p.cpu, 0),
  };
}

export function planCleanup(
  procs: readonly ProcessInfo[],
  opts: CleanupOptions
): CleanupPlan {
  const table = buildTable(procs);
  const blocked = protectedPids(table, opts);
  const isDev = makeIsDev(table, blocked);
  const roots = new Set<number>();
  for (const p of procs) {
    if (isDev(p.pid)) roots.add(rootOf(table, p.pid, isDev));
  }
  // A root nested under another root (via a non-dev binary) is already covered.
  const nested = (pid: number): boolean =>
    ancestors(table, pid)
      .slice(1)
      .some((a) => roots.has(a));
  const groups = [...roots]
    .filter((pid) => !nested(pid))
    .flatMap((pid) => table.byPid.get(pid) ?? [])
    .map((root) => toGroup(table, root))
    .filter((g) => !g.pids.some((pid) => blocked.has(pid)))
    .sort((a, b) => b.rssKb - a.rssKb);
  const killTools = opts.includeTools;
  return {
    targets: groups.filter((g) => killTools || g.reason !== 'tool'),
    kept: groups.filter((g) => !killTools && g.reason === 'tool'),
  };
}
