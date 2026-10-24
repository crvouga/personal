import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqliteState } from '../src/adapters/state.ts';
import { MemorySecrets, fakeVault } from '../src/testing/fakes.ts';
import { rotate } from '../src/application/rotate.ts';
import { sealDraft } from '../src/application/authorization.ts';
import { authorizePlan, newOperation } from '../src/application/plans.ts';
import type { SiteAdapter, WorkflowContext } from '../src/domain/ports.ts';
import type { OperationState } from '../src/domain/model.ts';
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'password-manager-rotation-'));
  const state = new SqliteState(directory);
  const secrets = new MemorySecrets();
  const fake = fakeVault([
    {
      id: 'vault',
      type: 1,
      name: 'test',
      notes: 'NOTES_CANARY',
      fields: [{ name: 'custom', value: 'CUSTOM_CANARY', type: 1 }],
      login: {
        username: 'alice',
        password: 'OLD_CANARY',
        totp: 'OTP_CANARY',
        uris: [{ uri: 'https://github.com', match: 0 }],
      },
    },
  ]);
  let password = 'OLD_CANARY';
  let submissions = 0;
  let disconnect = false;
  const site: SiteAdapter = {
    origin: 'https://github.com',
    prepare: async () => 'ready',
    change: async (input) => {
      submissions++;
      password = input.replacement;
      if (disconnect) throw new Error('BROWSER_SECRET_CANARY');
      return 'confirmed';
    },
    verify: async (credential) =>
      credential.password === password ? 'valid' : 'invalid',
    close: async () => {},
  };
  state.put('accounts', {
    id: 'account',
    origin: site.origin,
    username: 'alice',
    confirmed: true,
    auth: 'password',
    identityProvider: null,
    evidenceIds: [],
    vaultIds: ['vault'],
    credential: 'stored',
    recovery: 'unknown',
    mfa: 'unknown',
    priority: 50,
  });
  state.put('plans', {
    id: 'plan',
    operationIds: ['op'],
    authorizedAt: '2026-01-01',
    createdAt: '',
    expiresAt: '2099-01-01',
    policy: 'selected',
  });
  state.put(
    'operations',
    newOperation({
      id: 'op',
      planId: 'plan',
      accountId: 'account',
      kind: 'rotate',
      vaultId: 'vault',
      evidenceId: null,
    })
  );
  let counter = 0;
  const context: WorkflowContext = {
    state,
    secrets,
    vault: fake.vault,
    runtime: {
      now: () => '2026-01-01',
      id: () => String(counter++),
      password: () => 'NEW_CANARY',
    },
    site: async () => site,
  };
  sealDraft(state, state.get('plans', 'plan')!);
  authorizePlan(state, 'plan', context.runtime);
  return {
    context,
    state,
    secrets,
    fake,
    site,
    submissions: () => submissions,
    disconnect: () => {
      disconnect = true;
    },
    close: () => {
      state.close();
      rmSync(directory, { recursive: true });
    },
  };
}
void test('remote success then disconnect reconciles without submitting twice', async () => {
  const f = fixture();
  try {
    f.disconnect();
    const first = await rotate(f.context, 'op');
    assert.equal(first.state, 'requires_user_action');
    assert.equal(f.submissions(), 1);
    const done = await rotate(f.context, 'op');
    assert.equal(done.state, 'completed');
    assert.equal(f.submissions(), 1);
    const item = await f.fake.vault.get('vault');
    assert.equal(item.login?.password, 'NEW_CANARY');
    assert.equal(item['notes'], 'NOTES_CANARY');
    assert.equal(item.login?.totp, 'OTP_CANARY');
    assert.equal(item.fields?.[0]?.value, 'CUSTOM_CANARY');
    assert.equal(f.state.list('accounts')[0]?.credential, 'verified');
    const report = JSON.stringify([
      ...f.state.list('events'),
      ...f.state.list('operations'),
      ...f.state.list('actions'),
    ]);
    for (const canary of [
      'NEW_CANARY',
      'OLD_CANARY',
      'NOTES_CANARY',
      'OTP_CANARY',
      'BROWSER_SECRET_CANARY',
    ])
      assert.equal(report.includes(canary), false);
  } finally {
    f.close();
  }
});
void test('interruptions at every durable transition retain one replacement and recover', async () => {
  const boundaries: OperationState[] = [
    'planned',
    'prerequisites_ready',
    'credential_staged',
    'change_submitting',
    'change_confirmed',
    'vault_updated',
    'login_verified',
    'completed',
  ];
  for (const boundary of boundaries) {
    const f = fixture();
    let interrupted = false;
    f.context.checkpoint = (state) => {
      if (state === boundary && !interrupted) {
        interrupted = true;
        throw new Error('synthetic stop');
      }
    };
    try {
      await rotate(f.context, 'op');
      f.context.checkpoint = () => {};
      const done = await rotate(f.context, 'op');
      assert.equal(done.state, 'completed', boundary);
      assert.equal(f.submissions(), 1, boundary);
      assert.equal(
        f.secrets.values.get('operation/op/replacement'),
        'NEW_CANARY'
      );
    } finally {
      f.close();
    }
  }
});
void test('MFA is pending verification and concurrent vault edit is preserved', async () => {
  const f = fixture();
  try {
    f.site.verify = async () => 'challenge';
    const pending = await rotate(f.context, 'op');
    assert.equal(pending.state, 'requires_user_action');
    assert.equal(f.state.list('accounts')[0]?.credential, 'stored');
    f.fake.items[0]!.login!.password = 'EXTERNAL_CANARY';
    f.site.verify = async () => 'valid';
    const conflict = await rotate(f.context, 'op');
    assert.equal(conflict.state, 'reconciliation_required');
    assert.equal(f.fake.items[0]!.login!.password, 'EXTERNAL_CANARY');
  } finally {
    f.close();
  }
});
