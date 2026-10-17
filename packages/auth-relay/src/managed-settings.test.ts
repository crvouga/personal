import { expect, test } from 'bun:test';
import type { AuthRelayConfig } from '../../infra/lib/schema';
import { managedSettings } from '../development/managed-settings';

const production = {
  hostname: 'auth.example.test',
  realm: 'projects',
  vault_config: 'prd',
  google_client_id_key: 'GOOGLE_ID',
  google_client_secret_key: 'GOOGLE_SECRET',
  database_schema: 'auth_production',
  console_database_schema: 'auth_relay_production',
  setup_token_key: 'PRODUCTION_SETUP',
  service: { id: 'broker' },
  signing_key_generations: {},
};
const nonproduction = {
  ...production,
  hostname: 'auth-dev.example.test',
  realm: 'projects-dev',
  vault_config: 'dev',
  setup_token_key: 'NONPRODUCTION_SETUP',
  service: { id: 'broker-dev' },
};
const relay: AuthRelayConfig = {
  enabled: false,
  status: 'staged',
  instances: { production, nonproduction },
};
const secrets = {
  AUTH_RELAY_DATABASE_URL: 'postgres://console:private@managed.test/db',
  AUTH_CONSOLE_CLIENT_ID: 'console',
  AUTH_CONSOLE_CLIENT_SECRET: 'console-secret',
  AUTH_MANAGER_CLIENT_ID: 'manager',
  AUTH_MANAGER_CLIENT_SECRET: 'manager-secret',
  PRODUCTION_SETUP: 'production-setup',
  NONPRODUCTION_SETUP: 'nonproduction-setup',
};

test('managed defaults and setup secret follow the selected Vault scope', () => {
  for (const [scope, environment, instance] of [
    ['dev', 'nonproduction', nonproduction],
    ['prd', 'production', production],
  ] as const) {
    const settings = managedSettings(secrets, scope, relay);
    expect(settings.missing).toEqual([]);
    expect(settings.enabled).toBe(false);
    expect(settings.env['AUTH_ENVIRONMENT']).toBe(environment);
    expect(settings.env['AUTH_ORIGIN']).toBe(`https://${instance.hostname}`);
    expect(settings.env['AUTH_REALM']).toBe(instance.realm);
    expect(settings.env['AUTH_UPSTREAM']).toBe(
      `http://${instance.service.id}-identity.railway.internal:8080`
    );
    expect(settings.env['AUTH_SETUP_TOKEN']).toBe(
      secrets[instance.setup_token_key as keyof typeof secrets]
    );
    expect(settings.env['AUTH_DATABASE_URL']).toBe(
      secrets.AUTH_RELAY_DATABASE_URL
    );
  }
});

test('cross-environment selection, unknown and ambiguous Vault scopes fail', () => {
  expect(() =>
    managedSettings({ AUTH_ENVIRONMENT: 'production' }, 'dev', relay)
  ).toThrow('conflicts');
  expect(() => managedSettings({}, 'unknown', relay)).toThrow('exactly one');
  expect(() =>
    managedSettings({}, 'dev', {
      ...relay,
      instances: { nonproduction, other: nonproduction },
    })
  ).toThrow('exactly one');
});

test('existing Google and shared database credentials never substitute for relay credentials', () => {
  const { missing } = managedSettings(
    { DATABASE_URL: 'unrelated', GOOGLE_ID: 'id', GOOGLE_SECRET: 'secret' },
    'dev',
    relay
  );
  expect(missing).toEqual([
    'AUTH_RELAY_DATABASE_URL',
    'AUTH_CONSOLE_CLIENT_ID',
    'AUTH_CONSOLE_CLIENT_SECRET',
    'AUTH_MANAGER_CLIENT_ID',
    'AUTH_MANAGER_CLIENT_SECRET',
    'NONPRODUCTION_SETUP',
  ]);
});

test('explicit routing and blank-secret errors are preserved without mutating the input', () => {
  const source = {
    ...secrets,
    AUTH_UPSTREAM: 'http://127.0.0.1:18080',
    AUTH_MANAGER_CLIENT_SECRET: ' ',
  };
  const { env, missing } = managedSettings(source, 'dev', relay);
  expect(env['AUTH_UPSTREAM']).toBe(source.AUTH_UPSTREAM);
  expect(missing).toEqual(['AUTH_MANAGER_CLIENT_SECRET']);
  expect(source).not.toHaveProperty('AUTH_ORIGIN');
});
