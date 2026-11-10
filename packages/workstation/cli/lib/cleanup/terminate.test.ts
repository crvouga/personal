import { expect, test } from 'bun:test';
import { spawn } from 'node:child_process';

import { psProcesses } from '../../../../fleet/src/platform/ps';
import { descendants } from './plan';
import { terminateProcesses } from './terminate';

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function treeOf(pid: number): number[] {
  const children = new Map<number, number[]>();
  for (const p of psProcesses() ?? []) {
    children.set(p.ppid, [...(children.get(p.ppid) ?? []), p.pid]);
  }
  return descendants(children, pid);
}

async function waitForTree(pid: number, size: number): Promise<number[]> {
  for (let i = 0; i < 100; i++) {
    const tree = treeOf(pid);
    if (tree.length >= size) return tree;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`tree ${pid} never reached ${size} processes`);
}

test('kills a tree, SIGKILLing a child that ignores SIGTERM', async () => {
  // Root shell → { sleep, TERM-ignoring shell → sleep } = 4 processes.
  const root = spawn(
    'sh',
    ['-c', 'sleep 60 & sh -c \'trap "" TERM; sleep 60 & wait\' & wait'],
    { stdio: 'ignore' }
  );
  const rootPid = root.pid ?? -1;
  const tree = await waitForTree(rootPid, 4);

  const report = await terminateProcesses(tree, {
    graceMs: 300,
    list: psProcesses,
    forbidden: new Set([0, 1, process.pid]),
  });

  expect(report.survivors).toEqual([]);
  expect(report.forced.length).toBeGreaterThan(0);
  // Reap our direct child so it is not left as a zombie.
  await new Promise((resolve) => {
    if (root.exitCode !== null || root.signalCode !== null) resolve(null);
    else root.once('exit', resolve);
  });
  expect(tree.filter(isAlive)).toEqual([]);
});

test('refuses forbidden pids', async () => {
  await expect(
    terminateProcesses([process.pid], {
      graceMs: 0,
      list: psProcesses,
      forbidden: new Set([process.pid]),
    })
  ).rejects.toThrow('forbidden');
});
