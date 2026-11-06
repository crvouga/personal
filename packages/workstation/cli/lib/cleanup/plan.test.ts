import { describe, expect, test } from 'bun:test';

import { parsePsOutput } from '../platform/ps';
import type { ProcessInfo } from '../platform/types';
import { planCleanup, type CleanupOptions } from './plan';

const UID = 501;

function proc(
  pid: number,
  ppid: number,
  command: string,
  extra: Partial<ProcessInfo> = {}
): ProcessInfo {
  return {
    pid,
    ppid,
    pgid: pid,
    uid: UID,
    rssKb: 1024,
    cpu: 1,
    state: 'S',
    command,
    ...extra,
  };
}

const OPTS: CleanupOptions = {
  selfPid: 999,
  uid: UID,
  includeTools: false,
  protect: [],
};

// launchd → Superset → login shell → { personal workstation cleanup, claude agent, … }
const BASE: ProcessInfo[] = [
  proc(1, 0, '/sbin/launchd', { uid: 0 }),
  proc(10, 1, '/Applications/Superset.app/Contents/MacOS/Superset'),
  proc(20, 10, '/bin/zsh -l'),
  proc(999, 20, 'bun /x/cli/bin.mjs cleanup'),
  proc(30, 20, '/Users/me/.local/bin/claude --dangerously-skip-permissions'),
];

function roots(procs: ProcessInfo[], opts: Partial<CleanupOptions> = {}) {
  const plan = planCleanup(procs, { ...OPTS, ...opts });
  return {
    targets: plan.targets.map((g) => [g.root.pid, g.reason, g.kind]),
    kept: plan.kept.map((g) => g.root.pid),
    pids: plan.targets.flatMap((g) => [...g.pids]).sort((a, b) => a - b),
  };
}

describe('planCleanup', () => {
  test('kills an agent shell-tool test run as one tree, through sh -c', () => {
    const r = roots([
      ...BASE,
      proc(40, 30, '/bin/zsh -c bun run check'),
      proc(41, 40, 'bun run check'),
      proc(42, 41, 'sh -c bun test'),
      proc(43, 42, 'bun test --preload x'),
      proc(44, 43, '/Users/me/.bun/bin/bun test --test-worker'),
    ]);
    expect(r.targets).toEqual([[41, 'shell', 'test']]);
    expect(r.pids).toEqual([41, 42, 43, 44]);
  });

  test('kills orphans and leaves agent-owned MCP servers', () => {
    const r = roots([
      ...BASE,
      proc(50, 1, 'node /repo/node_modules/.bin/vite dev'),
      proc(60, 30, 'npm exec @playwright/mcp@latest'),
      proc(61, 60, 'node /x/playwright-mcp'),
    ]);
    expect(r.targets).toEqual([[50, 'orphan', 'server']]);
    expect(r.kept).toEqual([60]);
    expect(
      roots([...BASE, proc(60, 30, 'npm exec mcp')], {
        includeTools: true,
      }).targets
    ).toEqual([[60, 'tool', 'process']]);
  });

  test('never touches self, own pipeline, agents, infra, or other users', () => {
    const r = roots(
      [
        ...BASE,
        proc(998, 20, 'bun -e consume', { pgid: 999 }),
        proc(999, 20, 'bun /x/cli/bin.mjs cleanup', { pgid: 999 }),
        proc(70, 20, 'node /Users/me/.npm/bin/codex'),
        proc(80, 1, 'node /repo/packages/9router/cli/index.ts'),
        proc(81, 80, 'node worker.js'),
        proc(90, 1, 'node server.js', { uid: 0 }),
        proc(95, 1, 'node keep-me.js'),
      ],
      { protect: [/keep-me/i] }
    );
    expect(r.targets).toEqual([]);
    expect(r.kept).toEqual([]);
  });

  test('skips a whole tree when it contains a protected process', () => {
    const r = roots([
      ...BASE,
      proc(40, 20, 'npm exec claude'),
      proc(41, 40, 'node /x/claude'),
    ]);
    expect(r.targets).toEqual([]);
  });

  test('ignores GUI app helpers but catches test browsers', () => {
    const r = roots([
      ...BASE,
      proc(100, 10, '/Applications/Code.app/Contents/MacOS/node x'),
      proc(
        110,
        1,
        '/Users/me/Library/Caches/ms-playwright/chromium-1/Chromium.app/Contents/MacOS/Chromium --headless'
      ),
    ]);
    expect(r.targets).toEqual([[110, 'orphan', 'browser']]);
  });

  test('reports nested roots once and ignores zombies', () => {
    const r = roots([
      ...BASE,
      proc(40, 20, 'node /x/dev.js'),
      proc(41, 40, '/opt/custom-launcher'),
      proc(42, 41, 'node child.js'),
      proc(50, 1, 'node dead.js', { state: 'Z' }),
    ]);
    expect(r.targets).toEqual([[40, 'shell', 'process']]);
    expect(r.pids).toEqual([40, 41, 42]);
  });
});

test('parsePsOutput handles spaces in args and skips junk', () => {
  const rows = parsePsOutput(
    [
      '  123     1   123   501  20480  12.5 Ss   /Applications/A B.app/Contents/MacOS/A B --x',
      'garbage',
      '',
    ].join('\n')
  );
  expect(rows).toEqual([
    {
      pid: 123,
      ppid: 1,
      pgid: 123,
      uid: 501,
      rssKb: 20480,
      cpu: 12.5,
      state: 'Ss',
      command: '/Applications/A B.app/Contents/MacOS/A B --x',
    },
  ]);
});
