import { afterEach, expect, test } from 'bun:test';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readEnrollment, saveEnrollment, withMachineLock } from './state';
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))
  );
});
async function root() {
  const path = await mkdtemp(join(tmpdir(), 'controller-state-'));
  roots.push(path);
  return path;
}
test('controller state saves an exact approved revision without fabricating application success', async () => {
  const directory = await root();
  expect(await readEnrollment(directory)).toBeNull();
  await saveEnrollment(directory, {
    version: 1,
    id: 'controller',
    approvedRevision: 'a'.repeat(40),
  });
  expect((await readEnrollment(directory))?.appliedRevision).toBeUndefined();
  expect(
    await readFile(join(directory, 'enrollment.json'), 'utf8')
  ).not.toContain('token');
});
test('overlapping controllers fail closed and a completed operation releases its lock', async () => {
  const directory = await root();
  await withMachineLock(directory, async () => {
    await expect(
      withMachineLock(directory, async () => 'unexpected')
    ).rejects.toThrow('locked');
  });
  expect(await withMachineLock(directory, async () => 'next')).toBe('next');
});
