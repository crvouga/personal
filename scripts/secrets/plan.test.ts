import { expect, test } from 'bun:test';
import { TOFU_VAULT_INPUTS_ADDRESS } from '../vault-inputs/model';
import { before, fills, inventory } from './fixtures';
import { stages, updateInputs } from './model';
import { reviewPlan } from './plan';

const next = updateInputs(before, fills, inventory.vault.kv_keys);
const steps = stages(next, fills, inventory);
const change = (
  address: string,
  old: unknown,
  after: unknown,
  actions = ['update']
) => ({ address, change: { actions, before: old, after } });

test('checks the full persisted source and rejects stale or partial maps', () => {
  const source = (old: unknown, after: unknown) => ({
    resource_changes: [
      change(
        TOFU_VAULT_INPUTS_ADDRESS,
        { value: JSON.stringify(old) },
        { value: JSON.stringify(after) }
      ),
    ],
  });
  expect(
    reviewPlan(source(before, next), steps[0], before, next, fills)
  ).toEqual([TOFU_VAULT_INPUTS_ADDRESS]);
  expect(() =>
    reviewPlan(
      source({ ...before, admin_passwords: {} }, next),
      steps[0],
      before,
      next,
      fills
    )
  ).toThrow('changed since');
  expect(() =>
    reviewPlan(
      source(before, { ...next, admin_passwords: {} }),
      steps[0],
      before,
      next,
      fills
    )
  ).toThrow('reviewed managed');
});

test('no-op plans still verify the desired values and every selected target must be present', () => {
  const entry = change(
    TOFU_VAULT_INPUTS_ADDRESS,
    { value: JSON.stringify(before) },
    { value: JSON.stringify(before) },
    ['no-op']
  );
  const plan = { resource_changes: [entry] };
  expect(reviewPlan(plan, steps[0], before, before, fills)).toEqual([]);
  expect(() => reviewPlan(plan, steps[0], before, next, fills)).toThrow(
    'reviewed managed inputs'
  );
  expect(() =>
    reviewPlan({ resource_changes: [] }, steps[0], before, next, fills)
  ).toThrow('omits a selected resource');
});

test('refuses resource creation, replacement, deletion, unrelated updates and malformed plans', () => {
  for (const entry of [
    change(TOFU_VAULT_INPUTS_ADDRESS, {}, {}, ['create']),
    change(TOFU_VAULT_INPUTS_ADDRESS, {}, {}, ['delete', 'create']),
    change(TOFU_VAULT_INPUTS_ADDRESS, {}, {}, ['delete']),
    change('railway_service.unrelated', {}, {}),
  ])
    expect(() =>
      reviewPlan({ resource_changes: [entry] }, steps[0], before, next, fills)
    ).toThrow();
  for (const malformed of [null, {}, { resource_changes: null }])
    expect(() =>
      reviewPlan(malformed, steps[0], before, next, fills)
    ).toThrow();
});

test('detects unselected KV deletion/rotation without printing any values', () => {
  const stage = {
    ...steps[1],
    addresses: ['vault_kv_secret_v2.personal["prd"]'],
  };
  const old = { ...before.secrets.prd, VAULT_TOKEN: 'must-never-print' };
  const after = { ...next.secrets.prd, VAULT_TOKEN: 'also-never-print' };
  const plan = {
    resource_changes: [
      change(
        'vault_kv_secret_v2.personal["prd"]',
        { data_json: JSON.stringify(old) },
        { data_json: JSON.stringify(after) }
      ),
    ],
  };
  try {
    reviewPlan(plan, stage, before, next, fills);
    throw new Error('Expected rejection');
  } catch (error) {
    expect(String(error)).toContain('unselected fields: VAULT_TOKEN');
    expect(String(error)).not.toContain('must-never-print');
    expect(String(error)).not.toContain('also-never-print');
  }
  const valid = {
    resource_changes: [
      change(
        'vault_kv_secret_v2.personal["prd"]',
        { data_json: JSON.stringify(old) },
        {
          data_json: JSON.stringify({ ...after, VAULT_TOKEN: old.VAULT_TOKEN }),
        }
      ),
    ],
  };
  expect(reviewPlan(valid, stage, before, next, fills)).toHaveLength(1);
});

test('only the Google credentials can change in an auth plan', () => {
  const old = {
    client_id: 'old',
    client_secret: 'private-old',
    realm: 'projects',
    trust_email: true,
  };
  const after = {
    ...old,
    client_id: next.secrets.prd.GOOGLE_OAUTH_CLIENT_ID,
    client_secret: next.secrets.prd.GOOGLE_OAUTH_CLIENT_SECRET,
  };
  const plan = (value: unknown) => ({
    resource_changes: [change(steps[2].addresses[0], old, value)],
  });
  expect(reviewPlan(plan(after), steps[2], before, next, fills)).toHaveLength(
    1
  );
  expect(() =>
    reviewPlan(
      plan({ ...after, trust_email: false }),
      steps[2],
      before,
      next,
      fills
    )
  ).toThrow('beyond its credentials');
  expect(() =>
    reviewPlan(
      plan({ ...after, client_secret: null }),
      steps[2],
      before,
      next,
      fills
    )
  ).toThrow('reviewed credentials');
});
