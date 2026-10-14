import { afterAll, beforeEach, describe, expect, test } from 'bun:test';

import {
  vaultAdminLogin,
  type VaultLoginDeps,
} from '../../src/auth/vault-login';
import { recordingLogger, startFakeVault } from '../support/fake-vault';

const vault = startFakeVault();
afterAll(() => vault.stop());

let log = recordingLogger();
const deps = (overrides: Partial<VaultLoginDeps> = {}): VaultLoginDeps => ({
  vaultAddr: vault.url,
  fetch,
  log,
  ...overrides,
});

beforeEach(() => {
  vault.calls.length = 0;
  vault.mode = 'normal';
  vault.failRevoke = false;
  log = recordingLogger();
});

describe('vaultAdminLogin', () => {
  test('an admin gets in, and the Vault token is revoked at once', async () => {
    expect(await vaultAdminLogin(deps(), 'chris', 'correct horse')).toBe(true);
    expect(vault.calls.map((c) => [c.method, c.path])).toEqual([
      ['POST', '/v1/auth/userpass/login/chris'],
      ['POST', '/v1/auth/token/revoke-self'],
    ]);
    expect(vault.calls[0]?.body).toEqual({ password: 'correct horse' });
    expect(vault.calls[1]?.token).toBe('tok-chris');
  });

  test('a user without the admin policy is refused, and the token is still revoked', async () => {
    expect(await vaultAdminLogin(deps(), 'ops.bob', 'bob-password')).toBe(
      false
    );
    expect(vault.calls.map((c) => c.path)).toEqual([
      '/v1/auth/userpass/login/ops.bob',
      '/v1/auth/token/revoke-self',
    ]);
    expect(vault.calls[1]?.token).toBe('tok-ops.bob');
  });

  test('a wrong password is refused and nothing is revoked because nothing was issued', async () => {
    expect(await vaultAdminLogin(deps(), 'chris', 'wrong')).toBe(false);
    expect(await vaultAdminLogin(deps(), 'nobody', 'x')).toBe(false);
    expect(vault.calls.every((c) => c.path.includes('/login/'))).toBe(true);
  });

  test('an invalid username never reaches Vault', async () => {
    for (const name of [
      '',
      '../sys/seal',
      'a/b',
      'a b',
      'x'.repeat(65),
      'chris?x=1',
      'chñris',
      'a\nb',
    ]) {
      expect(await vaultAdminLogin(deps(), name, 'correct horse')).toBe(false);
    }
    expect(vault.calls).toEqual([]);
  });

  test('an empty or enormous password never reaches Vault', async () => {
    expect(await vaultAdminLogin(deps(), 'chris', '')).toBe(false);
    expect(await vaultAdminLogin(deps(), 'chris', 'x'.repeat(513))).toBe(false);
    expect(vault.calls).toEqual([]);
  });

  test('without a Vault address, password login is off', async () => {
    expect(
      await vaultAdminLogin(deps({ vaultAddr: null }), 'chris', 'correct horse')
    ).toBe(false);
    expect(vault.calls).toEqual([]);
  });

  test('Vault being down is a refusal, not a crash', async () => {
    expect(
      await vaultAdminLogin(
        deps({ vaultAddr: 'http://127.0.0.1:1' }),
        'chris',
        'correct horse'
      )
    ).toBe(false);
    expect(log.lines.some((line) => line.includes('vault login failed'))).toBe(
      true
    );
  });

  test('a server error, garbage or a reply without policies is a refusal', async () => {
    for (const mode of ['error', 'garbage', 'no-policies'] as const) {
      vault.mode = mode;
      expect(await vaultAdminLogin(deps(), 'chris', 'correct horse')).toBe(
        false
      );
    }
  });

  test('a redirect is not followed', async () => {
    vault.mode = 'redirect';
    expect(await vaultAdminLogin(deps(), 'chris', 'correct horse')).toBe(false);
    expect(vault.calls.map((c) => c.path)).toEqual([
      '/v1/auth/userpass/login/chris',
    ]);
  });

  test('a Vault that never answers is given up on', async () => {
    vault.mode = 'hang';
    const started = Date.now();
    expect(
      await vaultAdminLogin(deps({ timeoutMs: 150 }), 'chris', 'correct horse')
    ).toBe(false);
    expect(Date.now() - started).toBeLessThan(2000);
  });

  test('a failed revoke is logged loudly but the verified admin still signs in', async () => {
    vault.failRevoke = true;
    expect(await vaultAdminLogin(deps(), 'chris', 'correct horse')).toBe(true);
    expect(
      log.lines.some((line) => line.includes('vault token revoke failed'))
    ).toBe(true);
  });

  test('the password and the Vault token are never logged', async () => {
    await vaultAdminLogin(deps(), 'chris', 'correct horse');
    await vaultAdminLogin(deps(), 'chris', 'wrong password');
    await vaultAdminLogin(deps(), 'ops.bob', 'bob-password');
    vault.mode = 'error';
    await vaultAdminLogin(deps(), 'chris', 'correct horse');
    const logged = log.lines.join('\n');
    for (const secret of [
      'correct horse',
      'wrong password',
      'bob-password',
      'tok-chris',
      'tok-ops.bob',
    ]) {
      expect(logged).not.toContain(secret);
    }
  });
});
