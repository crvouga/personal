import { expect, test } from 'bun:test';
import {
  adoptLive,
  parseVaultInputs,
  TOFU_VAULT_INPUTS_ADDRESS,
  unexpectedChanges,
  updatesSecrets,
  withFills,
} from './model';
import { RAILWAY_TOKEN_ADDRESS, repairInputs } from './rotation';

const change = (address: string, actions = ['update']) => ({
  address,
  change: { actions },
});

test('rotates an optional Railway token in the persisted inputs and the CI secret', () => {
  const before = parseVaultInputs(
    JSON.stringify({
      secrets: {
        dev: { RAILWAY_TOKEN: 'old', KEEP: 'dev' },
        prd: { RAILWAY_TOKEN: 'old', KEEP: 'prd' },
      },
      admin_passwords: { operator: 'keep' },
    })
  );
  const live = { RAILWAY_TOKEN: 'new' };
  const selected = ['RAILWAY_TOKEN'];
  const next = withFills(
    before,
    adoptLive(
      [{ name: 'RAILWAY_TOKEN', configs: ['dev', 'prd'] }],
      selected,
      live
    ),
    false
  );
  const env = {
    TF_VAR_railway_token: 'stale-ci-token',
    TF_VAR_state_passphrase: 'keep',
  };
  const repair = repairInputs(env, JSON.stringify(next), selected, live);
  expect(repair.env.TF_VAR_railway_token).toBe('new');
  expect(repair.env.TF_VAR_state_passphrase).toBe('keep');
  expect(env.TF_VAR_railway_token).toBe('stale-ci-token');
  expect(JSON.parse(repair.env.TF_VAR_vault_inputs)).toEqual({
    secrets: {
      dev: { RAILWAY_TOKEN: 'new', KEEP: 'dev' },
      prd: { RAILWAY_TOKEN: 'new', KEEP: 'prd' },
    },
    admin_passwords: { operator: 'keep' },
  });
  expect(repair.addresses).toEqual([
    TOFU_VAULT_INPUTS_ADDRESS,
    RAILWAY_TOKEN_ADDRESS,
  ]);
  const plan = {
    resource_changes: [
      change(TOFU_VAULT_INPUTS_ADDRESS),
      change(RAILWAY_TOKEN_ADDRESS),
    ],
  };
  expect(unexpectedChanges(plan, repair.addresses)).toEqual([]);
  expect(unexpectedChanges(plan)).toEqual([`${RAILWAY_TOKEN_ADDRESS}: update`]);
});

test('applies a CI-only rotation even if the Vault inputs already match', () => {
  const plan = {
    resource_changes: [
      change(TOFU_VAULT_INPUTS_ADDRESS, ['no-op']),
      change(RAILWAY_TOKEN_ADDRESS),
    ],
  };
  const repair = repairInputs({}, '{}', ['RAILWAY_TOKEN'], {
    RAILWAY_TOKEN: 'new',
  });
  expect(updatesSecrets(plan, repair.addresses)).toBe(true);
  expect(updatesSecrets(plan)).toBe(false);
});

test('requires an explicit rotation and a nonempty live value', () => {
  const unchanged = repairInputs(
    { TF_VAR_railway_token: 'keep' },
    '{}',
    ['OTHER'],
    { RAILWAY_TOKEN: 'new' }
  );
  expect(unchanged.env.TF_VAR_railway_token).toBe('keep');
  expect(unchanged.addresses).toEqual([TOFU_VAULT_INPUTS_ADDRESS]);
  for (const token of ['', ' ']) {
    expect(() =>
      repairInputs({}, '{}', ['RAILWAY_TOKEN'], { RAILWAY_TOKEN: token })
    ).toThrow('no value');
  }
});

test('still rejects unrelated changes and destructive secret actions', () => {
  const { addresses } = repairInputs({}, '{}', ['RAILWAY_TOKEN'], {
    RAILWAY_TOKEN: 'new',
  });
  for (const entry of [
    change('railway_service.other'),
    change(RAILWAY_TOKEN_ADDRESS, ['delete', 'create']),
    change(TOFU_VAULT_INPUTS_ADDRESS, ['delete']),
  ]) {
    expect(
      unexpectedChanges({ resource_changes: [entry] }, addresses)
    ).toHaveLength(1);
  }
});
