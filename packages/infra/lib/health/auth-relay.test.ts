import { expect, test } from 'bun:test';
import type { InfraConfig } from '../schema.js';
import { checkAuthRelay } from './check-auth-relay.js';
import { CONFIG, fakeContext, fakeFetch, statusOf, type Routes } from './fixtures.test-support.js';

const production = {
  hostname: 'auth.example.dev', realm: 'projects', vault_config: 'prd',
  google_client_id_key: 'GOOGLE_ID', google_client_secret_key: 'GOOGLE_SECRET',
  database_schema: 'auth_production', console_database_schema: 'auth_relay_production', setup_token_key: 'SETUP_TOKEN', signing_key_generations: { initial: { active: true, priority: 200 } },
};
const nonproduction = { ...production, hostname: 'auth-dev.example.dev', realm: 'projects-dev', vault_config: 'dev', database_schema: 'auth_nonproduction', console_database_schema: 'auth_relay_nonproduction', setup_token_key: 'SETUP_TOKEN_DEV' };
const config = { ...CONFIG, auth_relay: { enabled: true, status: 'preproduction', instances: { production, nonproduction } } };
const credentials = { SETUP_TOKEN_DEV: 'dev-setup-secret', SETUP_TOKEN: 'setup-secret', AUTH_RELAY_DATABASE_URL: 'test-db', AUTH_CONSOLE_CLIENT_ID: 'console', AUTH_CONSOLE_CLIENT_SECRET: 'console-secret', AUTH_MANAGER_CLIENT_ID: 'manager', AUTH_MANAGER_CLIENT_SECRET: 'manager-secret', GOOGLE_ID: 'test-id', GOOGLE_SECRET: 'do-not-print-this-test-secret' };
const issuer = `https://${production.hostname}/realms/${production.realm}`;
const discovery = { issuer, token_endpoint: `${issuer}/protocol/openid-connect/token`, jwks_uri: `${issuer}/protocol/openid-connect/certs`, code_challenge_methods_supported: ['S256'] };

function context(doc = discovery) {
  const routes: Record<string, Routes[string]> = {};
  for (const instance of [production, nonproduction]) {
    const base = `https://${instance.hostname}`;
    const id = `${base}/realms/${instance.realm}`;
    routes[`${base}/health/ready`] = { status: 200 };
    routes[`${id}/.well-known/openid-configuration`] = { body: { issuer: id, token_endpoint: `${id}/protocol/openid-connect/token`, jwks_uri: `${id}/protocol/openid-connect/certs`, code_challenge_methods_supported: ['S256'] } };
    routes[`${id}/protocol/openid-connect/certs`] = { body: { keys: [{ kid: 'key-1', use: 'sig' }] } };
  }
  routes[`${issuer}/.well-known/openid-configuration`] = { body: doc };
  return fakeContext({ config, kv: async () => ({ ok: true, data: credentials }), fetch: fakeFetch(routes) });
}

test('an undeclared relay skips without making live requests', async () => {
  expect((await checkAuthRelay(fakeContext()))[0]?.status).toBe('skip');
});
test('staged deployment still verifies both Vault environments without probing undeployed hosts', async () => {
  const reads: string[] = [];
  const seen: string[] = [];
  const ctx = context();
  const results = await checkAuthRelay({ ...ctx,
    config: { ...config, auth_relay: { ...config.auth_relay, enabled: false } },
    kv: async (name) => { reads.push(name); return { ok: true, data: credentials }; },
    fetch: fakeFetch({}, seen),
  });
  expect(reads.sort()).toEqual(['dev', 'prd']);
  expect(seen).toEqual([]);
  expect(statusOf(results, 'production credentials')).toBe('pass');
  expect(statusOf(results, 'nonproduction credentials')).toBe('pass');
  expect(statusOf(results, 'auth-relay')).toBe('skip');
  expect(JSON.stringify(results)).not.toContain(credentials.GOOGLE_SECRET);
});
test('missing and blank credentials fail in the correct environment; injected environment values cannot mask missing Vault values', async () => {
  const ctx = context();
  const results = await checkAuthRelay({ ...ctx, env: credentials,
    kv: async (name) => ({ ok: true, data: name === 'prd' ? { GOOGLE_SECRET: '  ' } : credentials }),
  });
  expect(statusOf(results, 'production credentials')).toBe('fail');
  expect(statusOf(results, 'nonproduction credentials')).toBe('pass');
  const detail = results.find((result) => result.name === 'production credentials')!.detail;
  expect(detail).toContain('secret/data/personal/prd');
  expect(detail).toContain('GOOGLE_ID');
  expect(detail).toContain('GOOGLE_SECRET');
  expect(JSON.stringify(results)).not.toContain(credentials.GOOGLE_SECRET);
});
test('unavailable Vault access skips, a missing document fails, and thrown errors never expose secrets', async () => {
  const ctx = context();
  for (const [unverifiable, expected] of [[true, 'skip'], [false, 'fail']] as const) {
    const results = await checkAuthRelay({ ...ctx, kv: async () => ({ ok: false, unverifiable, reason: credentials.GOOGLE_SECRET }) });
    expect(statusOf(results, 'production credentials')).toBe(expected);
    expect(JSON.stringify(results)).not.toContain(credentials.GOOGLE_SECRET);
  }
  const results = await checkAuthRelay({ ...ctx, kv: async () => { throw new Error(credentials.GOOGLE_SECRET); } });
  expect(statusOf(results, 'production credentials')).toBe('fail');
  expect(JSON.stringify(results)).not.toContain(credentials.GOOGLE_SECRET);
});
test('invalid isolation, Vault mapping and signing-key configuration fails before external reads', async () => {
  for (const instance of [
    { ...nonproduction, hostname: production.hostname },
    { ...nonproduction, database_schema: production.database_schema },
    { ...nonproduction, vault_config: 'unknown' },
    { ...nonproduction, setup_token_key: production.setup_token_key },
    { ...nonproduction, database_schema: production.console_database_schema },
    { ...nonproduction, signing_key_generations: {} },
    { ...nonproduction, google_client_secret_key: production.google_client_id_key },
  ]) {
    const invalid: InfraConfig = { ...config, auth_relay: { ...config.auth_relay, instances: { production, nonproduction: instance } } };
    const results = await checkAuthRelay({ ...context(), config: invalid,
      kv: async () => { throw new Error('no reads expected'); },
    });
    expect(results).toHaveLength(1);
    expect(statusOf(results, 'auth-relay configuration')).toBe('fail');
  }
});
test('expected discovery and keys pass; a foreign issuer fails', async () => {
  expect(statusOf(await checkAuthRelay(context()), 'production')).toBe('pass');
  expect(statusOf(await checkAuthRelay(context({ ...discovery, issuer: 'https://attacker.test' })), 'production')).toBe('fail');
});
test('missing PKCE support and broker outages fail', async () => {
  expect(statusOf(await checkAuthRelay(context({ ...discovery, code_challenge_methods_supported: [] })), 'production')).toBe('fail');
  expect(statusOf(await checkAuthRelay({ ...context(), fetch: fakeFetch({}) }), 'production')).toBe('fail');
});

test('enabled relay requires console and database secrets in Vault without leaking values', async () => {
  const ctx = context();
  const results = await checkAuthRelay({ ...ctx, kv: async () => ({ ok: true, data: { ...credentials, AUTH_MANAGER_CLIENT_SECRET: ' ' } }) });
  expect(statusOf(results, 'production credentials')).toBe('fail');
  expect(JSON.stringify(results)).toContain('AUTH_MANAGER_CLIENT_SECRET');
  expect(JSON.stringify(results)).not.toContain(credentials.AUTH_CONSOLE_CLIENT_SECRET);
});

test('disabled relay still fails missing runtime credentials before local dev attempts startup', async () => {
  const ctx = context();
  const results = await checkAuthRelay({ ...ctx,
    config: { ...config, auth_relay: { ...config.auth_relay, enabled: false } },
    kv: async () => ({ ok: true, data: { GOOGLE_ID: 'id', GOOGLE_SECRET: 'secret', SETUP_TOKEN: 'setup', SETUP_TOKEN_DEV: 'setup-dev' } }),
  });
  for (const name of ['production credentials', 'nonproduction credentials']) {
    expect(statusOf(results, name)).toBe('fail');
    const detail = results.find((result) => result.name === name)!.detail;
    for (const key of ['AUTH_RELAY_DATABASE_URL', 'AUTH_CONSOLE_CLIENT_ID', 'AUTH_CONSOLE_CLIENT_SECRET', 'AUTH_MANAGER_CLIENT_ID', 'AUTH_MANAGER_CLIENT_SECRET'])
      expect(detail).toContain(key);
  }
});
