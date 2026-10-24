import { expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sourceFiles } from './source-files';

test('policy enumeration includes tracked and new sources, including force-added ignored files', () => {
  const root = mkdtempSync(join(tmpdir(), 'ci-sources-'));
  try {
    execFileSync('git', ['init', '--quiet'], { cwd: root });
    writeFileSync(join(root, '.gitignore'), '*.ignored\n');
    for (const name of [
      'tracked.ts',
      'new.ts',
      'cached.ignored',
      'tracked.ignored',
      'deleted.ts',
    ])
      writeFileSync(join(root, name), 'fixture');
    execFileSync(
      'git',
      ['add', '-f', 'tracked.ts', 'tracked.ignored', 'deleted.ts'],
      { cwd: root }
    );
    unlinkSync(join(root, 'deleted.ts'));
    expect(sourceFiles(root).sort()).toEqual([
      '.gitignore',
      'new.ts',
      'tracked.ignored',
      'tracked.ts',
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
