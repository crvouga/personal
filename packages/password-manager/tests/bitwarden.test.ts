import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  BitwardenVault,
  bitwardenExecutable,
  BW_VERSION,
} from '../src/adapters/bitwarden.ts';
import { command, baseEnvironment } from '../src/adapters/process.ts';
import { MemorySecrets } from '../src/testing/fakes.ts';
import { parseConfig } from '../src/domain/config.ts';
void test('locked CLI executable runs with package-owned appdata and no personal login', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'password-manager-bw-'));
  try {
    const version = await command({
      executable: process.execPath,
      args: [bitwardenExecutable(), '--version'],
      env: { ...baseEnvironment(), BITWARDENCLI_APPDATA_DIR: directory },
    });
    assert.equal(version.trim(), BW_VERSION);
    const config = parseConfig({
      version: 1,
      bitwarden: { email: 'synthetic@example.test' },
    });
    const vault = new BitwardenVault({
      directory,
      expected: config.bitwarden!,
      secrets: new MemorySecrets(),
    });
    const status = await vault.status();
    assert.equal(status.status, 'unauthenticated');
    assert.equal(status.userEmail, null);
    await assert.rejects(vault.list(), /not-authenticated/);
  } finally {
    rmSync(directory, { recursive: true });
  }
});
