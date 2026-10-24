import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  mkdirSync,
  readFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { demo } from '../src/application/demo.ts';
import { parseConfig } from '../src/domain/config.ts';
const root = fileURLToPath(new URL('../../../', import.meta.url));
void test('offline integrated demo discovers, imports and verifies rotation without live services', async () => {
  const result = await demo();
  assert.equal(result.imported.state, 'completed');
  assert.equal(result.rotated.state, 'completed');
  assert.equal(result.accounts[0]?.credential, 'verified');
  assert.equal(JSON.stringify(result).includes('SYNTHETIC_ONLY'), false);
});
void test('cold launcher reaches mise before Node/Bun and explains an absent manager', () => {
  const directory = mkdtempSync(join(tmpdir(), 'password-manager-bootstrap-'));
  const bin = join(directory, 'bin');
  mkdirSync(bin);
  // dirname is an OS prerequisite; no Node/Bun executable is available on this PATH.
  writeFileSync(join(bin, 'dirname'), '#!/bin/sh\n/usr/bin/dirname "$@"\n', {
    mode: 0o700,
  });
  writeFileSync(join(bin, 'cat'), '#!/bin/sh\n/bin/cat "$@"\n', {
    mode: 0o700,
  });
  try {
    const missing = spawnSync(
      '/bin/sh',
      [join(root, 'scripts/password-manager-setup.sh')],
      { env: { PATH: bin }, encoding: 'utf8' }
    );
    assert.equal(missing.status, 2);
    assert.ok(missing.stderr.includes('mise trust mise.toml'));
    writeFileSync(
      join(bin, 'mise'),
      '#!/bin/sh\nif [ "$1" = install ]; then exit 0; fi\nexit 19\n',
      { mode: 0o700 }
    );
    const managed = spawnSync(
      '/bin/sh',
      [join(root, 'scripts/password-manager-setup.sh')],
      { env: { PATH: bin }, encoding: 'utf8' }
    );
    assert.equal(managed.status, 19);
  } finally {
    rmSync(directory, { recursive: true });
  }
});
void test('safe example configuration is accepted by the production schema', () => {
  const result = spawnSync(
    process.execPath,
    ['packages/password-manager/bin.mjs', '--help'],
    { cwd: root, encoding: 'utf8' }
  );
  assert.equal(result.status, 0);
  assert.ok(result.stdout.includes('backup'));
  const example = JSON.parse(
    readFileSync(
      join(root, 'packages/password-manager/config.example.json'),
      'utf8'
    )
  ) as unknown;
  assert.equal(parseConfig(example).execution.autoApply, false);
});
