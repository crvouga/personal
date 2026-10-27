import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { authSetup, type Deps } from './auth-setup/flow';
import {
  googleCallbacks,
  poll,
  schemaName,
  type Inventory,
} from './auth-setup/model';

const inventory = JSON.parse(
  readFileSync(
    'packages/infra/tofu/modules/inventory/inventory.tf.json',
    'utf8'
  )
).locals.inventory as Inventory;

test('Google callbacks and schema validation belong only to configured relay instances', () => {
  expect(googleCallbacks(inventory)).toHaveLength(
    Object.keys(inventory.auth_relay.instances).length
  );
  const relay = inventory.auth_relay.instances['production']!;
  expect(schemaName(relay)).toBe('auth_relay_production');
  expect(() =>
    schemaName({ ...relay, console_database_schema: 'invalid;schema' })
  ).toThrow();
});

test('poll retries boundedly until the bootstrap state appears', async () => {
  let count = 0;
  expect(
    await poll(async () => (++count === 3 ? true : undefined), {
      timeoutMs: 30,
      intervalMs: 10,
      sleep: async () => {},
    })
  ).toBe(true);
  expect(
    await poll(async () => undefined, {
      timeoutMs: 10,
      intervalMs: 10,
      sleep: async () => {},
    })
  ).toBeUndefined();
});

test('setup needs only the relay database and never writes service inventory or another application database', async () => {
  const scopes: string[] = [],
    databases: string[] = [];
  let closed = false;
  const production = inventory.auth_relay.instances['production']!;
  const d: Deps = {
    inventory,
    vault: async (scope) => {
      scopes.push(scope);
      return {
        AUTH_RELAY_DATABASE_URL: 'postgres://relay-fixture',
        [production.setup_token_key]: 'setup-fixture',
      };
    },
    store: (url) => {
      databases.push(url);
      return {
        operatorCount: async () => 1,
        close: async () => {
          closed = true;
        },
      };
    },
    io: {
      say() {},
      ask: async () => '',
      confirm: async () => true,
      copy: async () => false,
      open: async () => {},
      get: async () => ({ status: 200, body: '{}' }),
      gitEmail: async () => '',
      sleep: async () => {},
      now: () => new Date(),
    },
  };
  await authSetup(d);
  expect(scopes).toEqual([production.vault_config]);
  expect(databases).toEqual(['postgres://relay-fixture']);
  expect(closed).toBe(true);
});
