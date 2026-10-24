import { expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const cli = join(import.meta.dirname, '../../node_modules/.bin/prettier');

test('formatting cache still rejects changed content and changed configuration', () => {
  const directory = mkdtempSync(join(tmpdir(), 'format-cache-'));
  try {
    const path = join(directory, 'fixture.js');
    writeFileSync(join(directory, '.prettierrc'), '{"singleQuote":true}');
    const run = () =>
      Bun.spawnSync(
        [
          cli,
          '--check',
          'fixture.js',
          '--cache',
          '--cache-strategy',
          'content',
          '--cache-location',
          'results',
        ],
        { cwd: directory }
      ).exitCode;
    writeFileSync(path, "const value = 'formatted';\n");
    expect(run()).toBe(0);
    expect(run()).toBe(0);
    writeFileSync(path, 'const value="unformatted"\n');
    expect(run()).toBe(1);
    writeFileSync(path, "const value = 'formatted';\n");
    expect(run()).toBe(0);
    writeFileSync(join(directory, '.prettierrc'), '{"singleQuote":false}');
    expect(run()).toBe(1);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
