import type { Operation } from '../domain/model.ts';
import type { WorkflowContext, VaultItem } from '../domain/ports.ts';
import { mergeImport } from '../domain/import-merge.ts';
import { ManagerError } from '../domain/errors.ts';
import { originOf } from '../domain/identity.ts';
import { assertAuthorized } from './authorization.ts';
import { transition } from './rotation-state.ts';
import { isCancelled, cancelOperation } from './cancellation.ts';
export async function updateImportedItem(
  context: WorkflowContext,
  op: Operation,
  source: VaultItem
): Promise<{ op: Operation; item: VaultItem } | null> {
  if (!op.vaultId) throw new ManagerError('missing');
  return context.state.withLock(`vault-item:${op.vaultId}`, async () =>
    performUpdate(context, op, source)
  );
}
async function performUpdate(
  context: WorkflowContext,
  input: Operation,
  source: VaultItem
) {
  const fresh = await context.vault.get(input.vaultId!);
  verifyIdentity(context, input, fresh);
  if (input.importMode === 'preserve') return { op: input, item: fresh };
  const op = await stageUpdate(context, input, fresh, source);
  const desired = JSON.parse(
    (await context.secrets.getRequired(op.stagedRef!)).readSecretValue()
  ) as VaultItem;
  if (sameItem(fresh, desired)) return { op, item: fresh };
  const old = JSON.parse(
    (await context.secrets.getRequired(op.oldRef!)).readSecretValue()
  ) as VaultItem;
  if (!sameItem(fresh, old)) {
    transition(context, op, 'reconciliation_required');
    return null;
  }
  const preflight = await context.vault.get(op.vaultId!);
  if (!sameItem(preflight, fresh)) {
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
  await context.vault.edit(desired);
  const readback = await context.vault.get(op.vaultId!);
  if (!sameItem(readback, desired)) {
    transition(context, intent, 'reconciliation_required');
    return null;
  }
  return { op: intent, item: readback };
}
async function stageUpdate(
  context: WorkflowContext,
  op: Operation,
  fresh: VaultItem,
  source: VaultItem
): Promise<Operation> {
  const oldRef = `operation/${op.id}/old-item`;
  const stagedRef = `operation/${op.id}/import-item`;
  if (!(await context.secrets.getOptional(oldRef)))
    await context.secrets.setSecret(oldRef, JSON.stringify(fresh));
  if (!(await context.secrets.getOptional(stagedRef))) {
    const desired = mergeImport(
      fresh,
      source,
      op.importMode ?? 'merge-metadata'
    );
    await context.secrets.setSecret(stagedRef, JSON.stringify(desired));
  }
  if (op.submittedAt) return op;
  return transition(context, { ...op, oldRef, stagedRef }, 'credential_staged');
}
function verifyIdentity(
  context: WorkflowContext,
  op: Operation,
  item: VaultItem
): void {
  const account = context.state.get('accounts', op.accountId);
  if (!account || item.login?.username !== account.username)
    throw new ManagerError('conflict');
  if (!item.login?.uris?.some((u) => originOf(u.uri) === account.origin))
    throw new ManagerError('conflict');
}
export function sameItem(left: VaultItem, right: VaultItem): boolean {
  const normalize = (item: VaultItem) => ({
    ...item,
    revisionDate: null,
    passwordHistory: null,
  });
  return JSON.stringify(normalize(left)) === JSON.stringify(normalize(right));
}
