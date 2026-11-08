import { expect, test } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { runCommand } from '../../fleet/src/runner';

test('personal infra-vault preserves caller project directory while loading its source-owned domain', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'personal-vault-'));
  const root = resolve(import.meta.dir, '../../..');
  try {
    const result = await runCommand(
      [
        'bun',
        join(root, 'packages/personal-cli/src/cli.ts'),
        '--workspace',
        root,
        'infra-vault',
        'setup',
        '--project',
        'fixture',
        '--config',
        'dev',
      ],
      { cwd: directory, timeoutMs: 10_000 }
    );
    expect(result.ok).toBe(true);
    expect(await readFile(join(directory, '.vault.yaml'), 'utf8')).toContain(
      'fixture'
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('workspace flags belonging to the injected child survive the owner routing boundary', async () => {
  const { stripOwnerWorkspace } = await import('../src/app');
  expect(
    stripOwnerWorkspace([
      '--workspace',
      '/repo',
      'infra-vault',
      'run',
      '--',
      'node',
      'tool',
      '--workspace',
      '/child',
    ])
  ).toEqual([
    'infra-vault',
    'run',
    '--',
    'node',
    'tool',
    '--workspace',
    '/child',
  ]);
});
