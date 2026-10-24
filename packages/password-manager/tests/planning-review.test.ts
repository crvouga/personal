import { test } from 'node:test';
import assert from 'node:assert/strict';
import { workflowFixture } from './fixtures/workflow.ts';
import { recordMappings, undoMapping } from '../src/application/decisions.ts';
import { reconcile } from '../src/application/reconcile.ts';
import { createPlan, authorizePlan } from '../src/application/plans.ts';
import {
  assertAuthorized,
  revisePlan,
  discardPlan,
} from '../src/application/authorization.ts';
import { applyOperation, applyPlan } from '../src/application/apply.ts';
import { migrationPlan } from '../src/application/migration-plan.ts';

void test('identity decisions are reversible and rediscovery does not erase aliases or import mappings', () => {
  const f = workflowFixture(false);
  try {
    const raw = f.state.get('evidence', 'evidence')!;
    const decisions = recordMappings(
      f.state,
      [
        {
          evidenceId: raw.id,
          origin: 'https://other.example',
          username: 'Alice',
          auth: 'sso',
        },
      ],
      f.context.runtime
    );
    reconcile(f.state);
    assert.deepEqual(f.state.get('evidence', raw.id), raw);
    assert.equal(f.state.list('accounts')[0]?.auth, 'sso');
    f.state.put('evidence', raw);
    reconcile(f.state);
    assert.equal(f.state.list('accounts')[0]?.username, 'Alice');
    undoMapping(f.state, decisions[0]!.id);
    reconcile(f.state);
    assert.equal(f.state.list('accounts').length, 1);
    assert.equal(f.state.list('accounts')[0]?.username, 'alice');
    assert.equal(f.state.list('accounts')[0]?.origin, 'https://github.com');
    f.state.put('imports', {
      id: raw.id,
      sourceId: raw.sourceId,
      sourceRef: raw.sourceRef,
      vaultId: 'imported',
      operationId: 'operation',
      verifiedAt: f.clock.now,
    });
    f.state.put('evidence', raw);
    reconcile(f.state);
    assert.deepEqual(f.state.list('accounts')[0]?.vaultIds, ['imported']);
  } finally {
    f.close();
  }
});
void test('a later vault revision invalidates previous password verification without claiming the credential is invalid', () => {
  const f = workflowFixture();
  try {
    const account = f.state.get('accounts', f.accountId)!;
    f.state.put('accounts', {
      ...account,
      credential: 'verified',
      credentialRevision: 'revision-1',
      credentialVerifiedAt: f.clock.now,
    });
    const evidence = f.state.get('evidence', 'evidence')!;
    f.state.put('evidence', { ...evidence, vaultRevision: 'revision-1' });
    reconcile(f.state);
    assert.equal(f.state.get('accounts', f.accountId)?.credential, 'verified');
    f.state.put('evidence', { ...evidence, vaultRevision: 'revision-2' });
    reconcile(f.state);
    assert.equal(f.state.get('accounts', f.accountId)?.credential, 'stale');
    assert.equal(
      f.state.get('accounts', f.accountId)?.credentialVerifiedAt,
      f.clock.now
    );
  } finally {
    f.close();
  }
});
void test('batch decisions roll back and plans freeze their selected identities and secret references', () => {
  const f = workflowFixture();
  try {
    assert.throws(() =>
      recordMappings(
        f.state,
        [
          {
            evidenceId: 'evidence',
            origin: 'https://valid.test',
            username: 'alice',
          },
          {
            evidenceId: 'absent',
            origin: 'https://other.test',
            username: 'alice',
          },
        ],
        f.context.runtime
      )
    );
    assert.equal(f.state.list('decisions').length, 0);
    const plan = createPlan({ ...f.context, config: f.config, kind: 'rotate' });
    authorizePlan(f.state, plan.id, f.context.runtime);
    const op = f.state.get('operations', plan.operationIds[0]!)!;
    assert.throws(
      () =>
        recordMappings(
          f.state,
          [
            {
              evidenceId: 'evidence',
              origin: 'https://other.test',
              username: 'alice',
            },
          ],
          f.context.runtime
        ),
      /busy/
    );
    const account = f.state.get('accounts', f.accountId)!;
    f.state.put('accounts', { ...account, username: 'changed' });
    assert.throws(
      () => assertAuthorized(f.state, op, f.context.runtime),
      /conflict/
    );
    f.state.put('accounts', account);
    f.state.put('evidence', {
      ...f.state.get('evidence', 'evidence')!,
      candidateRef: 'candidate/new',
    });
    assert.throws(
      () => assertAuthorized(f.state, op, f.context.runtime),
      /conflict/
    );
    discardPlan(f.state, plan.id);
  } finally {
    f.close();
  }
});
void test('expired plans require a fresh reviewed plan before submitting', async () => {
  const f = workflowFixture();
  try {
    const plan = createPlan({ ...f.context, config: f.config, kind: 'rotate' });
    authorizePlan(f.state, plan.id, f.context.runtime);
    f.clock.now = '2026-01-03T00:00:00.000Z';
    const op = await applyOperation(f.context, plan.operationIds[0]!);
    assert.equal(op.state, 'requires_user_action');
    assert.equal(f.submissions(), 0);
    const revised = revisePlan(f.state, plan.id, f.context.runtime);
    authorizePlan(f.state, revised.id, f.context.runtime);
    assert.equal((await applyPlan(f.context, revised.id)).state, 'completed');
    assert.equal(f.submissions(), 1);
  } finally {
    f.close();
  }
});
void test('selected metadata migration preserves current password and recovers a lost edit response', async () => {
  const f = workflowFixture();
  try {
    const source = {
      ...f.item,
      id: 'source',
      notes: 'SOURCE_NOTES',
      login: { ...f.item.login, password: 'STALE_EXPORT_PASSWORD' },
    };
    await f.secrets.setSecret('candidate/source', JSON.stringify(source));
    const plan = migrationPlan({
      context: f.context,
      config: f.config,
      evidenceId: 'evidence',
      vaultId: 'vault',
      mode: 'merge-metadata',
    });
    authorizePlan(f.state, plan.id, f.context.runtime);
    const edit = f.fake.vault.edit;
    f.fake.vault.edit = async (item) => {
      await edit(item);
      throw new Error('LOST_RESPONSE_CANARY');
    };
    const first = await applyOperation(f.context, plan.operationIds[0]!);
    assert.equal(first.state, 'requires_user_action');
    const second = await applyOperation(f.context, plan.operationIds[0]!);
    assert.equal(second.state, 'completed');
    const current = await f.fake.vault.get('vault');
    assert.equal(current.login?.password, 'CURRENT_PASSWORD');
    assert.equal(
      current['notes'],
      'CURRENT_NOTES\n\n[Imported source notes]\nSOURCE_NOTES'
    );
    assert.equal(f.fake.edits(), 1);
    assert.equal(f.state.get('imports', 'evidence')?.status, 'updated');
  } finally {
    f.close();
  }
});
void test('scheduled work defers a human challenge; explicit recovery and cancellation retain correct outcomes', async () => {
  const f = workflowFixture();
  try {
    const plan = createPlan({ ...f.context, config: f.config, kind: 'rotate' });
    authorizePlan(f.state, plan.id, f.context.runtime);
    const id = plan.operationIds[0]!;
    f.state.put('operations', {
      ...f.state.get('operations', id)!,
      state: 'requires_user_action',
      resumeState: 'planned',
    });
    await applyOperation({ ...f.context, deferUserActions: true }, id);
    assert.equal(f.submissions(), 0);
    assert.equal((await applyOperation(f.context, id)).state, 'completed');
    const next = createPlan({ ...f.context, config: f.config, kind: 'rotate' });
    authorizePlan(f.state, next.id, f.context.runtime);
    const cancelled = await applyOperation(
      { ...f.context, cancelled: () => true },
      next.operationIds[0]!
    );
    assert.equal(cancelled.state, 'cancelled');
    assert.equal(f.submissions(), 1);
  } finally {
    f.close();
  }
});

void test('unsupported transfer work is explicit and selected folder/ownership mappings survive rediscovery', async () => {
  const f = workflowFixture(false);
  try {
    const original = {
      ...f.item,
      organizationId: 'source-org',
      folderId: 'source-folder',
      collectionIds: ['source-collection'],
    };
    await f.secrets.setSecret('candidate/source', JSON.stringify(original));
    const raw = {
      ...f.state.get('evidence', 'evidence')!,
      unsupported: [
        'folder-reference-requires-destination-mapping',
        'shared-ownership-requires-explicit-destination',
      ],
    };
    f.state.put('evidence', raw);
    const planned = createPlan({
      ...f.context,
      config: f.config,
      kind: 'import',
    });
    assert.equal(planned.operationIds.length, 0);
    assert.equal(planned.issues?.[0]?.reason, 'unsupported-transfer-fields');
    assert.equal(f.state.list('actions').length, 1);
    const { configureImport } =
      await import('../src/application/migration-config.ts');
    await configureImport(f.context, {
      evidenceId: 'evidence',
      folderId: 'none',
      personal: true,
    });
    f.state.put('evidence', raw);
    reconcile(f.state);
    const selected = createPlan({
      ...f.context,
      config: f.config,
      kind: 'import',
    });
    assert.equal(selected.operationIds.length, 1);
    authorizePlan(f.state, selected.id, f.context.runtime);
    assert.equal((await applyPlan(f.context, selected.id)).state, 'completed');
    assert.equal((await f.fake.vault.list())[0]?.organizationId, null);
    assert.equal((await f.fake.vault.list())[0]?.['folderId'], null);
    assert.equal(
      (await f.secrets.getRequired('candidate/source')).readSecretValue(),
      JSON.stringify(original)
    );
    assert.deepEqual(f.state.get('evidence', 'evidence'), raw);
  } finally {
    f.close();
  }
});
