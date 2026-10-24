import type { Config } from '../domain/config.ts';
import type {
  Account,
  Evidence,
  Operation,
  OperationKind,
  Plan,
} from '../domain/model.ts';
import type { Runtime, StateStore } from '../domain/ports.ts';
import { ManagerError } from '../domain/errors.ts';
import { effectiveEvidence } from './decisions.ts';
import { migrationIssues } from './migration-issues.ts';
import { sealDraft, validateDraft } from './authorization.ts';
import { stableId } from '../domain/identity.ts';
interface PlanInput {
  state: StateStore;
  runtime: Runtime;
  config: Config;
  kind: OperationKind;
  accountId?: string;
  replacementOperationId?: string;
  targetFactor?: string;
}
export function createPlan(input: PlanInput): Plan {
  return input.state.transaction(() => createDraft(input));
}
function createDraft(input: PlanInput): Plan {
  const { state, runtime, config } = input;
  const plan: Plan = {
    id: runtime.id(),
    createdAt: runtime.now(),
    operationIds: [],
    authorizedAt: null,
    expiresAt: new Date(
      Date.parse(runtime.now()) + config.execution.planLifetimeHours * 3600_000
    ).toISOString(),
    policy: 'inspect',
    vaultIdentity: config.bitwarden
      ? { server: config.bitwarden.server, email: config.bitwarden.email }
      : null,
    issues: [],
  };
  for (const account of state.list('accounts')) {
    if (!selectedAccount(account, input.accountId)) continue;
    const candidates = effectiveEvidence(state).filter(
      (e) => account.evidenceIds.includes(e.id) && e.candidateRef
    );
    if (input.kind === 'import')
      plan.issues!.push(...migrationIssues(state, account, candidates));
    if (!eligible(account, candidates, input.kind)) continue;
    if (hasActiveOperation(state, account.id, input.kind)) continue;
    const evidence = candidates[0];
    const op = newOperation({
      id: stableId(plan.id, account.id, input.kind),
      planId: plan.id,
      accountId: account.id,
      kind: input.kind,
      ...operationReferences(account, evidence),
    });
    state.put('operations', {
      ...op,
      ...guidedSelection(input),
    });
    plan.operationIds.push(op.id);
  }
  return persistDraft(state, plan);
}
export function newOperation(
  input: Pick<
    Operation,
    'id' | 'planId' | 'accountId' | 'kind' | 'vaultId' | 'evidenceId'
  >
): Operation {
  return {
    ...input,
    runId: null,
    state: 'planned',
    resumeState: null,
    stagedRef: null,
    oldRef: null,
    expectedRevision: null,
    submittedAt: null,
    verifiedAt: null,
    completedAt: null,
    attempts: 0,
    error: null,
  };
}
function authorizeDraft(state: StateStore, id: string, runtime: Runtime): Plan {
  const plan = state.get('plans', id);
  if (!plan) throw new ManagerError('missing');
  if (Date.parse(plan.expiresAt) < Date.parse(runtime.now()))
    throw new ManagerError('expired-connection');
  validateDraft(state, plan);
  const selected: Plan = {
    ...plan,
    authorizedAt: runtime.now(),
    policy: 'selected',
  };
  state.put('plans', selected);
  return selected;
}

function eligible(
  account: Account,
  candidates: Evidence[],
  kind: OperationKind
): boolean {
  if (kind === 'rotate')
    return account.auth === 'password' && account.vaultIds.length === 1;
  if (kind === 'import')
    return (
      account.vaultIds.length === 0 &&
      candidates.length === 1 &&
      candidates[0]!.unsupported.length === 0
    );
  return true;
}
function hasActiveOperation(
  state: StateStore,
  accountId: string,
  kind: OperationKind
): boolean {
  return state
    .list('operations')
    .some(
      (o) =>
        o.accountId === accountId &&
        o.kind === kind &&
        !['completed', 'cancelled', 'failed'].includes(o.state)
    );
}

export function authorizePlan(
  state: StateStore,
  id: string,
  runtime: Runtime
): Plan {
  return state.transaction(() => authorizeDraft(state, id, runtime));
}

function persistDraft(state: StateStore, plan: Plan): Plan {
  return plan.operationIds.length || plan.issues?.length
    ? sealDraft(state, plan)
    : { ...plan, scope: [] };
}

function selectedAccount(
  account: Account,
  accountId: string | undefined
): boolean {
  return account.confirmed && (!accountId || account.id === accountId);
}

function operationReferences(account: Account, evidence: Evidence | undefined) {
  return {
    vaultId: account.vaultIds[0] ?? null,
    evidenceId: evidence?.id ?? null,
  };
}
function guidedSelection(input: PlanInput) {
  return {
    replacementOperationId: input.replacementOperationId ?? null,
    targetFactor: input.targetFactor ?? null,
  };
}
