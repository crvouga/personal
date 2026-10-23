import { expect, test } from 'bun:test';
import { before, fills, inventory } from './fixtures';
import { editableKeys, stages, updateInputs } from './model';

test('editing one scope preserves other scopes, unknown fields, passwords and fleet keys', () => {
  const original = structuredClone(before);
  const selected = fills.filter((fill) => fill.config === 'prd');
  const next = updateInputs(before, selected, inventory.vault.kv_keys);
  expect(next.secrets.dev).toEqual(before.secrets.dev);
  expect(next.secrets.prd.KEEP).toBe(before.secrets.prd.KEEP);
  expect(next.admin_passwords).toEqual(before.admin_passwords);
  expect(next.fleet_age_keys).toEqual(before.fleet_age_keys);
  expect(before).toEqual(original);
  expect(stages(next, selected, inventory).map((stage) => stage.state)).toEqual(
    ['foundation', 'vault', 'auth-production']
  );
});

test('rejects managed, unregistered, blank, malformed and wrong-scope edits', () => {
  const keys = [
    ...inventory.vault.kv_keys,
    { name: 'PRODUCTION_ONLY', configs: ['prd'] },
  ];
  expect(editableKeys(keys).map((key) => key.name)).not.toContain(
    'VAULT_TOKEN'
  );
  for (const fill of [
    { config: 'prd' as const, name: 'VAULT_TOKEN', value: 'private' },
    { config: 'prd' as const, name: 'UNREGISTERED', value: 'private' },
    { config: 'dev' as const, name: 'PRODUCTION_ONLY', value: 'private' },
    { config: 'prd' as const, name: 'GOOGLE_OAUTH_CLIENT_SECRET', value: '' },
    {
      config: 'prd' as const,
      name: 'GOOGLE_OAUTH_CLIENT_ID',
      value: 'not-google',
    },
  ])
    expect(() => updateInputs(before, [fill], keys)).toThrow();
});

test('synchronizes production provider rotations with CI without changing the other scope', () => {
  const selected = [
    { config: 'prd' as const, name: 'RAILWAY_TOKEN', value: 'new-token' },
  ];
  const next = updateInputs(before, selected, inventory.vault.kv_keys);
  const steps = stages(next, selected, inventory);
  expect(steps.map((stage) => stage.state)).toEqual(['foundation', 'vault']);
  expect(steps[0].addresses).toContain(
    'github_actions_secret.bootstrap["RAILWAY_TOKEN"]'
  );
  expect(steps[0].env.TF_VAR_railway_token).toBe('new-token');
  expect(next.secrets.dev).toEqual(before.secrets.dev);
});

test('blocks a Google update before writing source inputs when the relay is staged', () => {
  const staged = structuredClone(inventory);
  staged.auth_relay.live = false;
  expect(() =>
    stages(updateInputs(before, fills, inventory.vault.kv_keys), fills, staged)
  ).toThrow('not live');
});
