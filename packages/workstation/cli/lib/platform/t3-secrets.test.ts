import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { providerConfigSecretPath, syncAntigravityKey } from './t3-secrets';

let home = '';
beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 't3-secrets-'));
});
afterEach(() => rm(home, { recursive: true, force: true }));

test("the slot name matches T3's settingsSecrets naming", () => {
  expect(providerConfigSecretPath('id', 'antigravity', 'apiKey', '/h')).toBe(
    '/h/userdata/secrets/provider-config-aWQ-YW50aWdyYXZpdHk-YXBpS2V5.bin'
  );
});

test('the key is written privately and never reported', async () => {
  const check = await syncAntigravityKey(async () => 'sk-secret-value', home);
  expect(check.status).toBe('pass');
  expect(JSON.stringify(check)).not.toContain('sk-secret-value');
  const path = providerConfigSecretPath(
    'personal_antigravity_proxy',
    'antigravity',
    'apiKey',
    home
  );
  expect(await readFile(path, 'utf8')).toBe('sk-secret-value');
  expect((await stat(path)).mode & 0o777).toBe(0o600);
});

test('a missing Vault session fails with a stable code', async () => {
  const check = await syncAntigravityKey(async () => {
    throw new Error('raw vault detail');
  }, home);
  expect(check.summary).toBe('T3_ANTIGRAVITY_KEY_UNAVAILABLE');
  expect(JSON.stringify(check)).not.toContain('raw vault detail');
});
