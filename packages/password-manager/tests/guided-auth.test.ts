import { test } from 'node:test';
import assert from 'node:assert/strict';
import { workflowFixture } from './fixtures/workflow.ts';
import { createPlan, authorizePlan } from '../src/application/plans.ts';
import { applyOperation } from '../src/application/apply.ts';
import {
  attestGuided,
  captureIssuedMaterial,
} from '../src/application/guided-auth.ts';

void test('factor removal requires a completed tested replacement for the same account', async () => {
  const f = workflowFixture();
  try {
    const denied = createPlan({
      ...f.context,
      config: f.config,
      kind: 'factor-remove',
    });
    authorizePlan(f.state, denied.id, f.context.runtime);
    const deniedId = denied.operationIds[0]!;
    assert.equal((await applyOperation(f.context, deniedId)).submittedAt, null);
    assert.throws(
      () => attestGuided(f.context, deniedId),
      /requires-user-action/
    );
    const replacement = createPlan({
      ...f.context,
      config: f.config,
      kind: 'factor-replace',
    });
    authorizePlan(f.state, replacement.id, f.context.runtime);
    const replacementId = replacement.operationIds[0]!;
    await applyOperation(f.context, replacementId);
    assert.equal(attestGuided(f.context, replacementId).verifiedAt, null);
    f.state.put('operations', {
      ...f.state.get('operations', deniedId)!,
      state: 'cancelled',
    });
    const removal = createPlan({
      ...f.context,
      config: f.config,
      kind: 'factor-remove',
      replacementOperationId: replacementId,
      targetFactor: 'old-key',
    });
    authorizePlan(f.state, removal.id, f.context.runtime);
    const ready = await applyOperation(f.context, removal.operationIds[0]!);
    assert.ok(ready.submittedAt);
    assert.equal(ready.state, 'requires_user_action');
    assert.equal(f.submissions(), 0);
  } finally {
    f.close();
  }
});
void test('recovery issuance intent and encrypted material survive restart without repeat regeneration', async () => {
  const f = workflowFixture();
  try {
    const plan = createPlan({
      ...f.context,
      config: f.config,
      kind: 'recovery-regenerate',
    });
    authorizePlan(f.state, plan.id, f.context.runtime);
    const id = plan.operationIds[0]!;
    await assert.rejects(
      captureIssuedMaterial(f.context, id, 'RECOVERY_CANARY'),
      /invalid-input/
    );
    const pending = await applyOperation(f.context, id);
    assert.ok(pending.submittedAt);
    assert.throws(() => attestGuided(f.context, id), /requires-user-action/);
    const before = f.state.list('events').length;
    await applyOperation(f.context, id);
    assert.equal(
      f.state.list('events').filter((e) => e.state === 'change_submitting')
        .length,
      1
    );
    assert.ok(f.state.list('events').length >= before);
    const captured = await captureIssuedMaterial(
      f.context,
      id,
      'RECOVERY_CANARY'
    );
    assert.equal(captured.state, 'change_confirmed');
    assert.equal(
      JSON.stringify(f.state.list('operations')).includes('RECOVERY_CANARY'),
      false
    );
    await assert.rejects(
      captureIssuedMaterial(f.context, id, 'OTHER_CODES'),
      /conflict/
    );
    assert.equal(attestGuided(f.context, id).state, 'completed');
    assert.equal(
      f.state.get('accounts', f.accountId)?.recovery,
      'user-attested'
    );
  } finally {
    f.close();
  }
});
