import { expect, test } from 'bun:test';
import {
  diffNames,
  fillsFromLive,
  findGaps,
  inputsFromState,
  legacyPresent,
  parseVaultInputs,
  TOFU_VAULT_INPUTS_ADDRESS,
  unexpectedChanges,
  updatesVaultInputs,
  withFills,
} from './model';

const keys = [
  { name: 'GOOGLE_OAUTH_CLIENT_ID', configs: ['dev', 'prd'], required: true },
  { name: 'PROD_ONLY', configs: ['prd'], required: true },
  {
    name: 'AUTH_RELAY_DATABASE_URL',
    configs: ['dev', 'prd'],
    required: true,
    generated: true,
  },
  { name: 'OPTIONAL', configs: ['dev', 'prd'] },
];
const base = (dev: Record<string, string>, prd: Record<string, string>) =>
  parseVaultInputs(JSON.stringify({ secrets: { dev, prd }, extra: 1 }));

test('rejects malformed inputs', () => {
  expect(() => parseVaultInputs('nope')).toThrow('not valid JSON');
  expect(() => parseVaultInputs('{}')).toThrow('secrets is missing');
  expect(() =>
    parseVaultInputs('{"secrets":{"dev":{"A":1},"prd":{}}}')
  ).toThrow('secrets.dev.A');
});

test('keeps unrelated top-level inputs such as fleet_age_keys', () => {
  expect(base({}, {})['extra']).toBe(1);
});

test('finds only required, operator-supplied gaps per config', () => {
  const gaps = findGaps(
    base({ GOOGLE_OAUTH_CLIENT_ID: ' ' }, { PROD_ONLY: 'x' }),
    keys
  );
  expect(gaps.map((g) => `${g.config}.${g.name}`)).toEqual([
    'dev.GOOGLE_OAUTH_CLIENT_ID',
    'prd.GOOGLE_OAUTH_CLIENT_ID',
  ]);
});

test('offers the legacy value for a renamed field', () => {
  const inputs = base({ WEB_CLIENT_GOOGLE_CLIENT_ID: 'old' }, {});
  const [gap] = findGaps(inputs, keys);
  expect(gap?.legacy).toEqual({
    name: 'WEB_CLIENT_GOOGLE_CLIENT_ID',
    value: 'old',
  });
  expect(legacyPresent(inputs)).toEqual(['dev.WEB_CLIENT_GOOGLE_CLIENT_ID']);
});

test('fills gaps and drops legacy fields without touching the original', () => {
  const inputs = base({ WEB_CLIENT_GOOGLE_CLIENT_ID: 'old' }, {});
  const next = withFills(
    inputs,
    [{ config: 'dev', name: 'GOOGLE_OAUTH_CLIENT_ID', value: 'new' }],
    true
  );
  expect(next.secrets.dev).toEqual({ GOOGLE_OAUTH_CLIENT_ID: 'new' });
  expect(inputs.secrets.dev).toEqual({ WEB_CLIENT_GOOGLE_CLIENT_ID: 'old' });
  expect(diffNames(inputs, next)).toEqual({
    added: ['dev.GOOGLE_OAUTH_CLIENT_ID'],
    removed: ['dev.WEB_CLIENT_GOOGLE_CLIENT_ID'],
    changed: [],
  });
});

test('reads the recorded secret from state, if present', () => {
  const state = (values: object) => ({
    values: {
      root_module: {
        resources: [{ address: TOFU_VAULT_INPUTS_ADDRESS, values }],
      },
    },
  });
  expect(inputsFromState(state({ value: '{"a":1}' }))).toBe('{"a":1}');
  expect(inputsFromState(state({ plaintext_value: 'x' }))).toBe('x');
  expect(inputsFromState(state({}))).toBeUndefined();
  expect(inputsFromState({})).toBeUndefined();
});

test('accepts a plan that only updates the vault inputs secret', () => {
  const plan = (changes: object[]) => ({ resource_changes: changes });
  const secret = {
    address: TOFU_VAULT_INPUTS_ADDRESS,
    change: { actions: ['update'] },
  };
  const other = {
    address: 'railway_service.x',
    change: { actions: ['delete', 'create'] },
  };
  expect(
    unexpectedChanges(
      plan([secret, { address: 'a', change: { actions: ['no-op'] } }])
    )
  ).toEqual([]);
  expect(updatesVaultInputs(plan([secret]))).toBe(true);
  expect(updatesVaultInputs(plan([]))).toBe(false);
  expect(unexpectedChanges(plan([secret, other]))).toEqual([
    'railway_service.x: delete + create',
  ]);
});

test('fills gaps from the live document, one value for every config', () => {
  const gaps = findGaps(base({}, {}), keys);
  expect(
    fillsFromLive(gaps, { GOOGLE_OAUTH_CLIENT_ID: 'live', UNRELATED: 'x' })
  ).toEqual([
    { config: 'dev', name: 'GOOGLE_OAUTH_CLIENT_ID', value: 'live' },
    { config: 'prd', name: 'GOOGLE_OAUTH_CLIENT_ID', value: 'live' },
  ]);
  expect(fillsFromLive(gaps, {})).toEqual([]);
});
