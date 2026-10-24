import type { WorkflowContext, VaultItem } from '../domain/ports.ts';
import type { Operation } from '../domain/model.ts';
import { effectiveEvidence } from './decisions.ts';
import { originOf } from '../domain/identity.ts';
import { updateImportedItem } from './import-update.ts';
import { ManagerError } from '../domain/errors.ts';
import { isCancelled, cancelOperation } from './cancellation.ts';
import { assertAuthorized } from './authorization.ts';
import { transition } from './rotation-state.ts';
const MARKER = 'workspace.password-manager.operation';
export async function importCredential(
  context: WorkflowContext,
  id: string
): Promise<Operation> {
  const op = context.state.get('operations', id);
  if (!op) throw new ManagerError('missing');
  return context.state.withLock(`account:${op.accountId}`, () =>
    executeImport(context, id)
  );
}
async function executeImport(
  context: WorkflowContext,
  id: string
): Promise<Operation> {
  let op = context.state.get('operations', id)!;
  if (op.state === 'completed') return op;
  const evidence = importEvidence(context, op);
  const candidate = JSON.parse(
    (await context.secrets.getRequired(evidence.candidateRef)).readSecretValue()
  ) as VaultItem;
  await context.vault.sync();
  const result = await importWrite(context, op, candidate);
  if (!result) return context.state.get('operations', id)!;
  op = result.op;
  const saved = result.item;
  const readback = await context.vault.get(saved.id);
  if (
    (op.importMode ?? 'create') === 'create' &&
    !verifiesCandidate(candidate, readback)
  )
    return transition(context, op, 'reconciliation_required');
  context.state.put('imports', {
    id: evidence.id,
    sourceId: evidence.sourceId,
    sourceRef: evidence.sourceRef,
    vaultId: saved.id,
    operationId: op.id,
    verifiedAt: context.runtime.now(),
    status:
      op.importMode === 'preserve'
        ? 'preserved'
        : (op.importMode ?? 'create') === 'create'
          ? 'imported'
          : 'updated',
  });
  const account = context.state.get('accounts', op.accountId)!;
  context.state.put('accounts', {
    ...account,
    vaultIds: [...new Set([...account.vaultIds, saved.id])],
    credential: 'stored',
  });
  resolveMigrationActions(context, evidence.id);
  return transition(
    context,
    { ...op, vaultId: saved.id, completedAt: context.runtime.now() },
    'completed'
  );
}
function verifiesCandidate(candidate: VaultItem, saved: VaultItem): boolean {
  return (
    Object.entries(candidate).every(([key, value]) => {
      if (['id', 'revisionDate', 'creationDate', 'fields'].includes(key))
        return true;
      return JSON.stringify(value) === JSON.stringify(saved[key]);
    }) &&
    (candidate.fields ?? []).every((field) =>
      saved.fields?.some((f) => JSON.stringify(f) === JSON.stringify(field))
    )
  );
}

function importEvidence(context: WorkflowContext, op: Operation) {
  assertAuthorized(context.state, op, context.runtime, context.vaultIdentity);
  const evidence = effectiveEvidence(context.state).find(
    (e) => e.id === op.evidenceId
  );
  if (
    !evidence?.candidateRef ||
    !evidence.confirmed ||
    (evidence.unsupported.length > 0 && op.importMode !== 'preserve')
  )
    throw new ManagerError('requires-user-action');
  return evidence as typeof evidence & { candidateRef: string };
}
function hasConflict(items: VaultItem[], candidate: VaultItem): boolean {
  return items.some(
    (item) =>
      item.login?.username === candidate.login?.username &&
      item.login?.uris?.some((u) =>
        candidate.login?.uris?.some(
          (c) => originOf(c.uri) !== null && originOf(c.uri) === originOf(u.uri)
        )
      )
  );
}
async function createItem(
  context: WorkflowContext,
  candidate: VaultItem,
  id: string
): Promise<VaultItem> {
  const { id: _id, revisionDate: _revision, ...fields } = candidate;
  return context.vault.create({
    ...fields,
    fields: [...(candidate.fields ?? []), { name: MARKER, value: id, type: 0 }],
  });
}

async function importWrite(
  context: WorkflowContext,
  op: Operation,
  candidate: VaultItem
) {
  if (op.importMode && op.importMode !== 'create')
    return updateImportedItem(context, op, candidate);
  const items = await context.vault.list();
  const acknowledged = items.filter((item) =>
    item.fields?.some((field) => field.name === MARKER && field.value === op.id)
  );
  if (acknowledged.length > 1) {
    transition(context, op, 'reconciliation_required');
    return null;
  }
  if (acknowledged[0]) return { op, item: acknowledged[0] };
  if (hasConflict(items, candidate)) {
    transition(context, op, 'reconciliation_required');
    return null;
  }
  if (isCancelled(context, op)) {
    cancelOperation(context, op);
    return null;
  }
  assertAuthorized(context.state, op, context.runtime, context.vaultIdentity);
  const intent = transition(
    context,
    { ...op, submittedAt: context.runtime.now() },
    'change_submitting'
  );
  return { op: intent, item: await createItem(context, candidate, op.id) };
}

function resolveMigrationActions(
  context: WorkflowContext,
  evidenceId: string
): void {
  for (const action of context.state
    .list('actions')
    .filter((a) => a.step === `migration-${evidenceId}`)) {
    context.state.put('actions', { ...action, status: 'resolved' });
  }
}
