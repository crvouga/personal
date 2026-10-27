import { expect, test } from 'bun:test';
import { before, fills, inventory } from './fixtures';
import {
  editableKeys,
  stages,
  updateInputs,
  vaultSecretVariables,
} from './model';

test('historical backend credentials are preserved in managed inputs but excluded from Vault variables', () => {
  const inputs = {
    ...before,
    state_passphrase: 'stale-state-passphrase',
    state_backend: { bucket: 'stale-bucket' },
    github_token: 'stale-provider-token',
  };
  const next = updateInputs(inputs, fills, inventory.vault.kv_keys);
  expect(next.state_passphrase).toBe(inputs.state_passphrase);
  expect(vaultSecretVariables(next)).toEqual({
    secrets: next.secrets,
    admin_passwords: next.admin_passwords,
  });
  const vault = stages(next, fills, inventory).find(
    (stage) => stage.root === 'vault'
  )!;
  expect(Object.keys(vault.env).sort()).toEqual([
    'TF_VAR_admin_passwords',
    'TF_VAR_secrets',
  ]);
});

test('editing one scope preserves other scopes, unknown fields, passwords and unrecognized maps', () => {
  const original = structuredClone(before);
  const selected = fills.filter((fill) => fill.config === 'prd');
  const next = updateInputs(before, selected, inventory.vault.kv_keys);
  expect(next.secrets.dev).toEqual(before.secrets.dev);
  expect(next.secrets.prd.KEEP).toBe(before.secrets.prd.KEEP);
  expect(next.admin_passwords).toEqual(before.admin_passwords);
  expect(next.legacy_input_map).toEqual(before.legacy_input_map);
  expect(before).toEqual(original);
  expect(stages(next, selected, inventory).map((stage) => stage.state)).toEqual(
    ['foundation', 'vault', 'auth-production']
  );
});

test('secret edits preserve isolated auth agent credential metadata in saved Vault inputs', () => {
  const auth_agent_credentials = {
    'example-dev': {
      config: 'dev',
      repository: 'owner/example',
      subject: 'repo:owner/example:ref:refs/heads/main',
      generation: 2,
    },
  };
  const next = updateInputs(
    { ...before, auth_agent_credentials },
    fills,
    inventory.vault.kv_keys
  );
  expect(vaultSecretVariables(next).auth_agent_credentials).toEqual(
    auth_agent_credentials
  );
  const vault = stages(next, fills, inventory).find(
    (stage) => stage.root === 'vault'
  )!;
  expect(JSON.parse(vault.env.TF_VAR_auth_agent_credentials!)).toEqual(
    auth_agent_credentials
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
