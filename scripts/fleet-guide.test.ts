import { expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { renderLlmsTxt } from './llms-txt';
import { execute } from '../packages/personal-cli/src/program';

const root = join(import.meta.dir, '..');
test('published guide inputs include the fleet flow and honest acceptance status', () => {
  const guide = renderLlmsTxt();
  expect(guide).toContain('npx @crvouga/personal fleet-sync');
  expect(guide).toContain('# Ubuntu developer fleet: controller operation');
  expect(guide).toContain('not yet a completed or published fleet');
  expect(guide).toContain('homelab, not cloud infrastructure');
});
test('documented executable examples parse through the public CLI without writes', async () => {
  const guide = await readFile(
    join(root, 'packages/fleet/docs/ubuntu-sync.md'),
    'utf8'
  );
  const examples = guide
    .split('\n')
    .filter((line) => line.startsWith('personal fleet'));
  expect(examples.length).toBeGreaterThan(0);
  for (const example of examples) {
    // Help validates every option but never runs approval, fetching or machine changes.
    const args = example
      .replace('FULL_40_CHARACTER_SHA', 'a'.repeat(40))
      .split(' ')
      .slice(1);
    const result = await execute(
      [...args, '--help'],
      { workspace: '/no-checkout', config: '/no-roster' },
      'test'
    );
    expect(result.exitCode).toBe(0);
  }
});
