import type { WorkflowContext } from '../domain/ports.ts';
import type { Operation, Run, Plan } from '../domain/model.ts';
import { ManagerError, safeCode } from '../domain/errors.ts';
import { rotate } from './rotate.ts';
import { importCredential } from './import.ts';
import { beginGuidedAuth } from './guided-auth.ts';
import { isCancelled, cancelOperation } from './cancellation.ts';
import { assertAuthorized } from './authorization.ts';
import { pause } from './rotation-state.ts';
async function executePlan(
  context: WorkflowContext,
  planId: string,
  runId?: string
): Promise<Run> {
  const plan = context.state.get('plans', planId);
  if (!plan?.authorizedAt) throw new ManagerError('invalid-input');
  const run = startRun(context, plan, runId);
  for (const id of plan.operationIds) {
    const op = context.state.get('operations', id)!;
    if (context.state.get('runs', run.id)?.cancelled) break;
    context.state.put('operations', { ...op, runId: run.id });
    await applyOperation(context, op.id);
  }
  const operations = plan.operationIds.map((id) =>
    context.state.get('operations', id)!
  );
  const cancelled = runCancelled(context, run.id);
  const done: Run = {
    ...run,
    cancelled,
    state: cancelled ? 'cancelled' : runOutcome(operations),
  };
  context.state.put('runs', done);
  return done;
}
export async function applyOperation(
  context: WorkflowContext,
  id: string
): Promise<Operation> {
  const op = context.state.get('operations', id);
  if (!op) throw new ManagerError('missing');
  if (shouldDefer(context, op)) return op;
  try {
    assertAuthorized(context.state, op, context.runtime, context.vaultIdentity);
    if (isCancelled(context, op)) return cancelOperation(context, op);
    if (op.kind === 'rotate') return await rotate(context, id);
    if (op.kind === 'import') return await importCredential(context, id);
    return await context.state.withLock(`account:${op.accountId}`, async () =>
      beginGuidedAuth(context, context.state.get('operations', id)!)
    );
  } catch (error) {
    const current = context.state.get('operations', id)!;
    if (safeCode(error) === 'busy') return { ...current, error: 'busy' };
    return pause(
      context,
      { ...current, error: safeCode(error) },
      safeCode(error)
    );
  }
}
function runOutcome(ops: Operation[]): Run['state'] {
  if (ops.every((op) => op.state === 'completed')) return 'completed';
  if (ops.some((op) => op.state === 'requires_user_action'))
    return 'requires-user-action';
  if (
    ops.some((op) =>
      [
        'completed',
        'outcome_unknown',
        'reconciliation_required',
        'cancelled',
      ].includes(op.state)
    )
  )
    return 'partial';
  return 'failed';
}

export async function applyPlan(
  context: WorkflowContext,
  planId: string,
  runId?: string
): Promise<Run> {
  return context.state.withLock(`plan:${planId}`, () =>
    executePlan(context, planId, runId)
  );
}
function runCancelled(context: WorkflowContext, id: string): boolean {
  return Boolean(
    context.cancelled?.() || context.state.get('runs', id)?.cancelled
  );
}

function shouldDefer(context: WorkflowContext, op: Operation): boolean {
  if (['completed', 'cancelled'].includes(op.state)) return true;
  return (
    context.deferUserActions === true &&
    [
      'requires_user_action',
      'reconciliation_required',
      'outcome_unknown',
    ].includes(op.state)
  );
}

function startRun(context: WorkflowContext, plan: Plan, runId?: string): Run {
  const run: Run = runId
    ? context.state.get('runs', runId)!
    : {
        id: context.runtime.id(),
        createdAt: context.runtime.now(),
        planId: plan.id,
        state: 'running',
        cancelled: false,
      };
  if (run.planId !== plan.id) throw new ManagerError('conflict');
  if (runId) {
    for (const id of plan.operationIds) {
      const op = context.state.get('operations', id)!;
      if (op.state === 'cancelled' && op.resumeState)
        context.state.put('operations', {
          ...op,
          state: op.resumeState,
          resumeState: null,
        });
    }
  }
  run.cancelled = false;
  run.state = 'running';
  context.state.put('runs', run);
  return run;
}
