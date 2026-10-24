import type { Operation } from '../domain/model.ts';
import type { SiteAdapter, WorkflowContext } from '../domain/ports.ts';
import { recheckAuthDependencies } from './auth-dependencies.ts';
import { ManagerError, safeCode } from '../domain/errors.ts';
import { isCancelled, cancelOperation } from './cancellation.ts';
import { assertAuthorized } from './authorization.ts';
import { pause, transition, credentials } from './rotation-state.ts';
import {
  reconcileChange,
  stageCredential,
  submitChange,
  updateVault,
  verifyLogin,
} from './rotation-steps.ts';
export async function rotate(
  context: WorkflowContext,
  id: string
): Promise<Operation> {
  const op = context.state.get('operations', id);
  if (!op) throw new ManagerError('missing');
  return context.state.withLock(`account:${op.accountId}`, async () =>
    execute(context, id)
  );
}
async function execute(
  context: WorkflowContext,
  id: string
): Promise<Operation> {
  let op = context.state.get('operations', id)!;
  const account = validateOperation(context, op);
  if (op.state === 'completed' || op.state === 'cancelled') return op;
  let site: SiteAdapter | null = null;
  try {
    site = await context.site(account.origin, account.id);
    if (op.state === 'requires_user_action' && op.resumeState) {
      op = transition(context, op, op.resumeState);
    }
    return await drive(context, op, site);
  } catch (error) {
    return handleFailure(context, id, error);
  } finally {
    await site?.close();
  }
}
async function drive(
  context: WorkflowContext,
  start: Operation,
  site: SiteAdapter
): Promise<Operation> {
  let op = start;
  for (let step = 0; step < 12; step++) {
    const before = op.state;
    if (isCancelled(context, op)) return cancelOperation(context, op);
    op = await advance(context, op, site);
    if (
      op.state === before ||
      [
        'completed',
        'requires_user_action',
        'reconciliation_required',
        'cancelled',
        'failed',
      ].includes(op.state)
    )
      return op;
  }
  return transition(context, op, 'reconciliation_required');
}
async function advance(
  context: WorkflowContext,
  op: Operation,
  site: SiteAdapter
): Promise<Operation> {
  switch (op.state) {
    case 'planned':
      return transition(context, op, 'prerequisites_ready');
    case 'prerequisites_ready':
      return stageCredential(context, op);
    case 'credential_staged':
      return submitChange(context, op, site);
    case 'change_submitting':
    case 'outcome_unknown':
    case 'reconciliation_required':
      return reconcileChange(context, op, site);
    case 'change_confirmed':
      return updateVault(context, op);
    case 'vault_updated':
      return verifyLogin(context, op, site);
    case 'login_verified':
      return finish(context, op);
    default:
      return op;
  }
}
async function finish(
  context: WorkflowContext,
  op: Operation
): Promise<Operation> {
  if (!op.vaultId) throw new ManagerError('missing');
  const input = await credentials(context, op);
  const item = await context.vault.get(op.vaultId);
  if (item.login?.password !== input.replacement || !op.verifiedAt)
    return transition(context, op, 'reconciliation_required');
  const done = transition(
    context,
    { ...op, completedAt: context.runtime.now() },
    'completed'
  );
  const account = context.state.get('accounts', op.accountId)!;
  context.state.put('accounts', {
    ...account,
    credential: 'verified',
    credentialRevision: item.revisionDate ?? null,
    credentialVerifiedAt: op.verifiedAt,
  });
  recheckAuthDependencies(context, done);
  for (const action of context.state
    .list('actions')
    .filter((a) => a.operationId === op.id)) {
    context.state.put('actions', { ...action, status: 'resolved' });
  }
  return done;
}

function validateOperation(context: WorkflowContext, op: Operation) {
  const account = context.state.get('accounts', op.accountId);
  if (!account || !account.confirmed || account.auth !== 'password')
    throw new ManagerError('invalid-input');
  assertAuthorized(context.state, op, context.runtime, context.vaultIdentity);
  return account;
}
function handleFailure(
  context: WorkflowContext,
  id: string,
  error: unknown
): Operation {
  const op = context.state.get('operations', id)!;
  if (op.state === 'completed') return op;
  const state = op.submittedAt ? 'outcome_unknown' : op.state;
  return pause(
    context,
    { ...op, state, error: safeCode(error) },
    safeCode(error)
  );
}
