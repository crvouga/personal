import { describe, expect, test } from 'bun:test';

import { ConfigurationError, readServerEnv, type EnvSource } from '../src/env';

import { sha256 } from './support/fixtures';

const VALID: EnvSource = {
  DATABASE_URL:
    'postgres://user:hunter2-secret@db.internal:5432/app?sslmode=require',
  FLEET_ADMIN_TOKEN: 'a'.repeat(32),
  FLEET_SESSION_SECRET: 'b'.repeat(32),
  FLEET_ROLE_TOKEN_HASHES: '{}',
};

function problems(source: EnvSource): string {
  try {
    readServerEnv(source);
  } catch (err: unknown) {
    if (err instanceof ConfigurationError) return err.message;
    throw err;
  }
  throw new Error('expected the environment to be refused');
}

describe('readServerEnv', () => {
  test('accepts the minimum and applies defaults', () => {
    expect(readServerEnv(VALID)).toEqual({
      databaseUrl: VALID['DATABASE_URL'] as string,
      port: 8080,
      databasePrepare: true,
      adminToken: 'a'.repeat(32),
      sessionSecret: 'b'.repeat(32),
      roleTokenHashes: {},
      vaultAddr: null,
      githubRepo: 'crvouga/workspace',
    });
  });

  test('reads every optional setting', () => {
    const env = readServerEnv({
      ...VALID,
      PORT: '9000',
      VAULT_ADDR: 'https://vault.example.com/',
      FLEET_GITHUB_REPO: 'someone/else',
      FLEET_DB_PREPARE: 'false',
      FLEET_ROLE_TOKEN_HASHES: JSON.stringify({
        ci: sha256('x').toUpperCase(),
        web: sha256('y'),
      }),
    });
    expect(env).toMatchObject({
      port: 9000,
      vaultAddr: 'https://vault.example.com',
      githubRepo: 'someone/else',
      databasePrepare: false,
      roleTokenHashes: { ci: sha256('x'), web: sha256('y') },
    });
  });

  test('trims whitespace and treats blank as unset', () => {
    const env = readServerEnv({
      ...VALID,
      PORT: '  ',
      VAULT_ADDR: '',
      FLEET_GITHUB_REPO: '  ',
    });
    expect(env.port).toBe(8080);
    expect(env.vaultAddr).toBeNull();
    expect(env.githubRepo).toBe('crvouga/workspace');
  });

  test('names every missing variable at once', () => {
    const message = problems({});
    for (const name of [
      'DATABASE_URL',
      'FLEET_ADMIN_TOKEN',
      'FLEET_SESSION_SECRET',
      'FLEET_ROLE_TOKEN_HASHES',
    ]) {
      expect(message).toContain(name);
    }
  });

  test('refuses short secrets', () => {
    expect(problems({ ...VALID, FLEET_ADMIN_TOKEN: 'a'.repeat(31) })).toContain(
      'FLEET_ADMIN_TOKEN must be at least 32'
    );
    expect(problems({ ...VALID, FLEET_SESSION_SECRET: 'short' })).toContain(
      'FLEET_SESSION_SECRET must be at least 32'
    );
  });

  test('refuses malformed role token hashes', () => {
    expect(problems({ ...VALID, FLEET_ROLE_TOKEN_HASHES: 'nope' })).toContain(
      'JSON object'
    );
    expect(problems({ ...VALID, FLEET_ROLE_TOKEN_HASHES: '[]' })).toContain(
      'JSON object'
    );
    expect(
      problems({ ...VALID, FLEET_ROLE_TOKEN_HASHES: '{"ci":"abc"}' })
    ).toContain('64 hex');
    expect(
      problems({
        ...VALID,
        FLEET_ROLE_TOKEN_HASHES: JSON.stringify({ gpu: sha256('x') }),
      })
    ).toContain('unknown role "gpu"');
  });

  test('refuses a bad port, database url, vault address, repo and prepare flag', () => {
    expect(problems({ ...VALID, PORT: '0' })).toContain('PORT');
    expect(problems({ ...VALID, PORT: 'http' })).toContain('PORT');
    expect(problems({ ...VALID, PORT: '70000' })).toContain('PORT');
    expect(problems({ ...VALID, DATABASE_URL: 'mysql://x/y' })).toContain(
      'postgres://'
    );
    expect(problems({ ...VALID, DATABASE_URL: 'not a url' })).toContain(
      'DATABASE_URL'
    );
    expect(problems({ ...VALID, VAULT_ADDR: 'ftp://vault' })).toContain(
      'VAULT_ADDR'
    );
    expect(problems({ ...VALID, FLEET_GITHUB_REPO: 'no-slash' })).toContain(
      'FLEET_GITHUB_REPO'
    );
    expect(problems({ ...VALID, FLEET_DB_PREPARE: 'maybe' })).toContain(
      'FLEET_DB_PREPARE'
    );
  });

  test('never prints a secret value, even when the value is the problem', () => {
    const message = problems({
      DATABASE_URL: 'mysql://user:hunter2-secret@db/app',
      FLEET_ADMIN_TOKEN: 'tiny-admin-secret',
      FLEET_SESSION_SECRET: 'tiny-session-secret',
      FLEET_ROLE_TOKEN_HASHES: '{"ci":"super-secret-not-hex"}',
    });
    for (const secret of [
      'hunter2-secret',
      'tiny-admin-secret',
      'tiny-session-secret',
      'super-secret-not-hex',
    ]) {
      expect(message).not.toContain(secret);
    }
  });
});
