import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { authSetup, type Deps } from './auth-setup/flow';
import type { Io } from './auth-setup/io';
import {
  configuredEnv,
  fleetEnv,
  fleetRegistration,
  fleetSignInAvailable,
  googleCallbacks,
  leaseExpiry,
  poll,
  schemaName,
  withServiceEnv,
  type Inventory,
} from './auth-setup/model';
import type { FleetClient, Store } from './auth-setup/store';

const inventoryPath = join(
  import.meta.dirname,
  '../packages/infra/tofu/modules/inventory/inventory.tf.json'
);
const text = readFileSync(inventoryPath, 'utf8');
const inventory = JSON.parse(text).locals.inventory as Inventory;
const now = new Date('2026-10-20T00:00:00Z');
const CLIENT = 'app-123e4567-e89b-12d3-a456-426614174000';

test('the registration is derived from the inventory, not hard-coded', () => {
  const reg = fleetRegistration(inventory, now);
  expect(reg.callback).toBe('https://fleet.chrisvouga.dev/auth/callback');
  expect(reg.issuer).toBe('https://auth.chrisvouga.dev/realms/projects');
  // One day inside the relay's 366-day production maximum.
  expect(reg.expires).toBe(leaseExpiry(now));
  expect(Date.parse(reg.expires) - now.getTime()).toBeLessThan(366 * 86400_000);
  expect(googleCallbacks(inventory)).toEqual([
    'https://auth.chrisvouga.dev/realms/projects/broker/google/endpoint',
    'https://auth-dev.chrisvouga.dev/realms/projects-dev/broker/google/endpoint',
  ]);
});

test("Fleet settings are accepted by Fleet's own validation shape", () => {
  const env = fleetEnv(fleetRegistration(inventory, now), CLIENT);
  const issuer = new URL(env['FLEET_OIDC_ISSUER']!);
  expect(issuer.protocol).toBe('https:');
  expect(issuer.pathname).toMatch(/^\/realms\/[A-Za-z0-9_-]+$/);
  expect(new URL(env['FLEET_PUBLIC_ORIGIN']!).origin).toBe(
    env['FLEET_PUBLIC_ORIGIN']!
  );
  expect(() => fleetEnv(fleetRegistration(inventory, now), 'fleet')).toThrow();
});

test('the inventory edit changes only the Fleet env lines and stays valid JSON', () => {
  const env = fleetEnv(fleetRegistration(inventory, now), CLIENT);
  const edited = withServiceEnv(text, 'fleet-api', env);
  const parsed = JSON.parse(edited).locals.inventory as Inventory;
  expect(configuredEnv(parsed)).toEqual({
    ...configuredEnv(inventory),
    ...env,
  });
  const removed = text.split('\n');
  const added = edited.split('\n');
  const newKeys = Object.keys(env).filter(
    (key) => !(key in configuredEnv(inventory))
  );
  expect(added.length - removed.length).toBe(newKeys.length);
  // Idempotent: applying the same settings again is a no-op.
  expect(withServiceEnv(edited, 'fleet-api', env)).toBe(edited);
  // Other services are untouched.
  expect(parsed.services.find((s) => s.id === 'portfolio')).toEqual(
    inventory.services.find((s) => s.id === 'portfolio')
  );
});

test('unsafe schema names never reach SQL', () => {
  const relay = inventory.auth_relay.instances['production']!;
  expect(schemaName(relay)).toBe('auth_relay_production');
  expect(() =>
    schemaName({ ...relay, console_database_schema: 'x; drop' })
  ).toThrow();
});

test('poll retries until a value appears or time runs out', async () => {
  let calls = 0;
  const sleeps: number[] = [];
  const sleep = async (ms: number) => void sleeps.push(ms);
  expect(
    await poll(async () => (++calls === 3 ? 'ok' : undefined), {
      timeoutMs: 100,
      intervalMs: 10,
      sleep,
    })
  ).toBe('ok');
  expect(sleeps).toEqual([10, 10]);
  expect(
    await poll(async () => undefined, { timeoutMs: 30, intervalMs: 10, sleep })
  ).toBeUndefined();
});

test("the sign-in page check matches Fleet's two login states", () => {
  expect(fleetSignInAvailable('<a>Continue with Google</a>')).toBe(true);
  expect(
    fleetSignInAvailable(
      'Google sign-in is unavailable until the authentication relay is configured.'
    )
  ).toBe(false);
});

// --- flow ------------------------------------------------------------------
function harness(options: {
  operators?: number;
  client?: FleetClient;
  emails?: number;
  relayUp?: boolean;
  declineGoogle?: boolean;
  loginPage?: string;
  configured?: boolean;
}) {
  const said: string[] = [];
  const copied: string[] = [];
  const opened: string[] = [];
  const inserted: string[] = [];
  let written: string | undefined;
  const state = { operators: options.operators ?? 0, client: options.client };
  const io: Io = {
    say: (line = '') => void said.push(line),
    ask: async (_q, fallback = '') => fallback,
    confirm: async (question, fallback = true) =>
      question.includes('Google client') ? !options.declineGoogle : fallback,
    copy: async (value) => (copied.push(value), true),
    open: async (url) => void opened.push(url),
    get: async (url) => {
      if (url.endsWith('/login'))
        return {
          status: 200,
          body: options.loginPage ?? 'Google sign-in is unavailable',
        };
      return options.relayUp === false
        ? { status: 503, body: '' }
        : { status: 200, body: '{}' };
    },
    gitEmail: async () => 'Me@Example.com',
    // Time passing is what lets the human finish the manual steps.
    sleep: async () => {
      if (!state.operators) state.operators = 1;
      else
        state.client ??= { id: CLIENT, expiresAt: '2027-10-20T00:00:00.000Z' };
    },
    now: () => now,
  };
  const store: Store = {
    operatorCount: async () => state.operators,
    fleetClient: async () => state.client,
    allowedEmails: async () => options.emails ?? 0,
    allowEmail: async (email) => void inserted.push(email),
    close: async () => {},
  };
  const base = options.configured
    ? withServiceEnv(
        text,
        'fleet-api',
        fleetEnv(fleetRegistration(inventory, now), CLIENT)
      )
    : text;
  const deps: Deps = {
    io,
    inventory: JSON.parse(base).locals.inventory as Inventory,
    inventoryText: base,
    writeInventory: (value) => void (written = value),
    vault: async () => ({
      AUTH_RELAY_SETUP_TOKEN_PRODUCTION: 'setup-secret',
      AUTH_RELAY_DATABASE_URL: 'postgres://relay',
      DATABASE_URL: 'postgres://fleet',
    }),
    store: () => store,
  };
  return { deps, said, copied, opened, inserted, written: () => written };
}

test('a fresh install walks every step and writes the Fleet settings', async () => {
  const h = harness({});
  await authSetup(h.deps);
  const output = h.said.join('\n');
  expect(output).toContain('Claim operator access');
  expect(output).toContain(`Found client ${CLIENT}`);
  expect(h.inserted).toEqual(['me@example.com']);
  expect(
    JSON.parse(h.written()!).locals.inventory.services.find(
      (s: { id: string }) => s.id === 'fleet-api'
    ).env.FLEET_OIDC_CLIENT_ID
  ).toBe(CLIENT);
  expect(output).toContain('Renew the Fleet registration before 2027-10-20');
  // The setup token goes to the clipboard and is never printed.
  expect(h.copied).toContain('setup-secret');
  expect(output).not.toContain('setup-secret');
  expect(output).not.toContain('postgres://');
});

test('a finished install skips every human step and only verifies', async () => {
  const h = harness({
    operators: 2,
    client: { id: CLIENT, expiresAt: null },
    emails: 1,
    configured: true,
    loginPage: 'Continue with Google',
  });
  await authSetup(h.deps);
  const output = h.said.join('\n');
  expect(output).toContain('already exists; skipping');
  expect(output).toContain('Fleet is already registered');
  expect(output).toContain('already has the relay settings');
  expect(output).toContain('offers Continue with Google');
  expect(h.written()).toBeUndefined();
  expect(h.inserted).toEqual([]);
});

test('it stops with a clear cause when the relay is not deployed yet', async () => {
  const h = harness({ relayUp: false });
  await expect(authSetup(h.deps)).rejects.toThrow(/not answering yet/);
});

test('it refuses to continue without a Vault login or deployed credentials', async () => {
  const h = harness({});
  h.deps.vault = async () => undefined;
  await expect(authSetup(h.deps)).rejects.toThrow(/vault:login/);
  h.deps.vault = async () => ({ DATABASE_URL: 'x' });
  await expect(authSetup(h.deps)).rejects.toThrow(/missing AUTH_RELAY/);
});

test('declining the Google step stops before anything is claimed', async () => {
  const h = harness({ declineGoogle: true });
  await expect(authSetup(h.deps)).rejects.toThrow(/redirect URIs/);
  expect(h.written()).toBeUndefined();
});
