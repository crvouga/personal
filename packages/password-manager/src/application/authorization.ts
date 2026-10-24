import type { Operation, Plan, PlanScope } from '../domain/model.ts';
import type { Runtime, StateStore } from '../domain/ports.ts';
import { effectiveEvidence } from './decisions.ts';
import { ManagerError } from '../domain/errors.ts';
export function operationScope(state: StateStore, op: Operation): PlanScope {
  const account = state.get('accounts', op.accountId);
  if (!account?.confirmed) throw new ManagerError('conflict');
  const evidence = effectiveEvidence(state).find((e) => e.id === op.evidenceId);
  return {
    ...(op.replacementOperationId
      ? { replacementOperationId: op.replacementOperationId }
      : {}),
    ...(op.targetFactor ? { targetFactor: op.targetFactor } : {}),
    importMode: op.importMode ?? 'create',
    operationId: op.id,
    accountId: account.id,
    origin: account.origin,
    username: account.username,
    auth: account.auth,
    kind: op.kind,
    vaultId: op.vaultId,
    evidenceId: op.evidenceId,
    candidateRef: evidence?.candidateRef ?? null,
  };
}
export function sealDraft(state: StateStore, plan: Plan): Plan {
  const scope = plan.operationIds.map((id) => {
    const op = state.get('operations', id);
    if (!op || op.planId !== plan.id) throw new ManagerError('conflict');
    return operationScope(state, op);
  });
  const sealed = {
    ...plan,
    scope,
    authorizedAt: null,
    policy: 'inspect' as const,
  };
  state.put('plans', sealed);
  return sealed;
}
export function assertAuthorized(
  state: StateStore,
  op: Operation,
  runtime: Runtime,
  vaultIdentity?: Plan['vaultIdentity']
): PlanScope {
  const { plan, scope } = selectedScope(state, op);
  if (
    JSON.stringify(plan.vaultIdentity ?? null) !==
    JSON.stringify(vaultIdentity ?? null)
  )
    throw new ManagerError('conflict');
  const current = operationScope(state, op);
  // Successful imports acquire the destination id during readback; that is an
  // outcome of the selected create, not authority to target another vault item.
  if (
    op.kind === 'import' &&
    op.state === 'completed' &&
    (op.importMode ?? 'create') === 'create'
  )
    current.vaultId = scope.vaultId;
  if (JSON.stringify(current) !== JSON.stringify(scope))
    throw new ManagerError('conflict');
  requireUnexpired(plan, op, runtime);
  return scope;
}
export function validateDraft(state: StateStore, plan: Plan): void {
  if (!plan.scope || plan.scope.length !== plan.operationIds.length)
    throw new ManagerError('requires-user-action');
  for (const scope of plan.scope) {
    const op = state.get('operations', scope.operationId);
    if (
      !op ||
      op.planId !== plan.id ||
      JSON.stringify(comparableScope(state, op, scope)) !==
        JSON.stringify(scope)
    )
      throw new ManagerError('conflict');
  }
}
export function revisePlan(
  state: StateStore,
  id: string,
  runtime: Runtime,
  vaultIdentity?: Plan['vaultIdentity']
): Plan {
  return state.transaction(() => {
    const previous = state.get('plans', id);
    if (!previous) throw new ManagerError('missing');
    const operations = previous.operationIds.map((op) =>
      state.get('operations', op)!
    );
    if (
      operations.some(
        (op) => op.submittedAt || op.state === 'change_submitting'
      )
    )
      throw new ManagerError('outcome-unknown');
    const next = {
      ...previous,
      vaultIdentity: vaultIdentity ?? null,
      id: runtime.id(),
      authorizedAt: null,
      createdAt: runtime.now(),
      expiresAt: new Date(Date.parse(runtime.now()) + 86400_000).toISOString(),
    };
    for (const op of operations)
      state.put('operations', { ...op, planId: next.id });
    return sealDraft(state, next);
  });
}
export function discardPlan(state: StateStore, id: string): void {
  state.transaction(() => {
    const plan = state.get('plans', id);
    if (!plan) throw new ManagerError('missing');
    for (const opId of plan.operationIds) {
      const op = state.get('operations', opId)!;
      if (op.submittedAt || op.state === 'change_submitting')
        throw new ManagerError('outcome-unknown');
      if (op.state !== 'completed')
        state.put('operations', { ...op, state: 'cancelled' });
    }
  });
}

function selectedScope(
  state: StateStore,
  op: Operation
): { plan: Plan; scope: PlanScope } {
  const plan = state.get('plans', op.planId);
  const scope = plan?.scope?.find((item) => item.operationId === op.id);
  if (!plan?.authorizedAt || !scope || !plan.operationIds.includes(op.id))
    throw new ManagerError('requires-user-action');
  return { plan, scope };
}
function requireUnexpired(plan: Plan, op: Operation, runtime: Runtime): void {
  if (!Number.isFinite(Date.parse(plan.expiresAt)))
    throw new ManagerError('invalid-input');
  if (
    !op.submittedAt &&
    op.state !== 'completed' &&
    Date.parse(plan.expiresAt) < Date.parse(runtime.now())
  )
    throw new ManagerError('expired-connection');
}

function comparableScope(
  state: StateStore,
  op: Operation,
  scope: PlanScope
): PlanScope {
  const current = operationScope(state, op);
  if (
    op.kind === 'import' &&
    op.state === 'completed' &&
    (op.importMode ?? 'create') === 'create'
  )
    current.vaultId = scope.vaultId;
  return current;
}
