import type { Operation } from '../domain/model.ts';
import type {
  SiteAdapter,
  WorkflowContext,
  VaultItem,
} from '../domain/ports.ts';
import { ManagerError } from '../domain/errors.ts';
import { isCancelled, cancelOperation } from './cancellation.ts';
import { assertAuthorized } from './authorization.ts';
import { credentials, pause, transition } from './rotation-state.ts';
export async function stageCredential(
  context: WorkflowContext,
  op: Operation
): Promise<Operation> {
  if (!op.vaultId) throw new ManagerError('missing');
  const item = await context.vault.get(op.vaultId);
  if (!item.login?.password || !item.login.username)
    throw new ManagerError('requires-user-action');
  assertItemIdentity(context, op, item);
  const oldRef = `operation/${op.id}/old`;
  const stagedRef = `operation/${op.id}/replacement`;
  if (!(await context.secrets.getOptional(oldRef))) {
    await context.secrets.setSecret(
      oldRef,
      JSON.stringify({
        username: item.login.username,
        password: item.login.password,
      })
    );
  }
  if (!(await context.secrets.getOptional(stagedRef)))
    await context.secrets.setSecret(stagedRef, context.runtime.password());
  return transition(
    context,
    { ...op, oldRef, stagedRef, expectedRevision: item.revisionDate ?? null },
    'credential_staged'
  );
}
export async function submitChange(
  context: WorkflowContext,
  op: Operation,
  site: SiteAdapter
): Promise<Operation> {
  if (op.attempts >= (context.maxAttempts ?? 2))
    return pause(context, op, 'attempt-limit');
  const input = await credentials(context, op);
  const prepared = await site.prepare(input.old);
  if (prepared === 'challenge')
    return pause(context, op, 'authentication-challenge');
  if (isCancelled(context, op)) return cancelOperation(context, op);
  assertAuthorized(context.state, op, context.runtime, context.vaultIdentity);
  const intent = transition(
    context,
    { ...op, attempts: op.attempts + 1, submittedAt: context.runtime.now() },
    'change_submitting'
  );
  const result = await site.change(input);
  if (result === 'confirmed')
    return transition(context, intent, 'change_confirmed');
  if (result === 'challenge') return pause(context, intent, 'change-challenge');
  return transition(context, intent, 'outcome_unknown');
}
export async function reconcileChange(
  context: WorkflowContext,
  op: Operation,
  site: SiteAdapter
): Promise<Operation> {
  const input = await credentials(context, op);
  const current = await site.verify({
    username: input.old.username,
    password: input.replacement,
  });
  if (current === 'valid') return transition(context, op, 'change_confirmed');
  if (current === 'challenge')
    return pause(context, op, 'verification-challenge');
  if (current !== 'invalid')
    return transition(context, op, 'reconciliation_required');
  const old = await site.verify(input.old);
  if (old === 'valid') return transition(context, op, 'credential_staged');
  if (old === 'challenge') return pause(context, op, 'verification-challenge');
  return transition(context, op, 'reconciliation_required');
}
export async function updateVault(
  context: WorkflowContext,
  op: Operation
): Promise<Operation> {
  return context.state.withLock(`vault-item:${op.vaultId}`, () =>
    writeVault(context, op)
  );
}
async function writeVault(
  context: WorkflowContext,
  op: Operation
): Promise<Operation> {
  if (!op.vaultId) throw new ManagerError('missing');
  const input = await credentials(context, op);
  const fresh = await context.vault.get(op.vaultId);
  if (fresh.login?.password === input.replacement)
    return transition(context, op, 'vault_updated');
  if (!matchesOld(fresh, input.old))
    return transition(context, op, 'reconciliation_required');
  const preflight = await context.vault.get(op.vaultId);
  if (JSON.stringify(preflight) !== JSON.stringify(fresh))
    return transition(context, op, 'reconciliation_required');
  await context.vault.edit({
    ...fresh,
    login: { ...fresh.login, password: input.replacement },
  });
  const readback = await context.vault.get(op.vaultId);
  if (
    !preservesItem(fresh, readback) ||
    readback.login?.password !== input.replacement
  ) {
    return transition(context, op, 'reconciliation_required');
  }
  return transition(context, op, 'vault_updated');
}
function preservesItem(before: VaultItem, after: VaultItem): boolean {
  const omit = (item: VaultItem) => ({
    ...item,
    revisionDate: null,
    login: { ...item.login, password: null },
    passwordHistory: null,
  });
  return JSON.stringify(omit(before)) === JSON.stringify(omit(after));
}
export async function verifyLogin(
  context: WorkflowContext,
  op: Operation,
  site: SiteAdapter
): Promise<Operation> {
  const input = await credentials(context, op);
  const result = await site.verify({
    username: input.old.username,
    password: input.replacement,
  });
  if (result === 'challenge')
    return pause(context, op, 'verification-challenge');
  if (result !== 'valid')
    return transition(context, op, 'reconciliation_required');
  return transition(
    context,
    { ...op, verifiedAt: context.runtime.now() },
    'login_verified'
  );
}

function matchesOld(
  item: VaultItem,
  old: { username: string; password: string }
): boolean {
  return (
    item.login?.password === old.password &&
    item.login.username === old.username
  );
}

function assertItemIdentity(
  context: WorkflowContext,
  op: Operation,
  item: VaultItem
): void {
  const account = context.state.get('accounts', op.accountId);
  if (!account || item.login?.username !== account.username)
    throw new ManagerError('conflict');
  const origins =
    item.login?.uris?.map((u) => {
      try {
        return new URL(u.uri).origin;
      } catch {
        return null;
      }
    }) ?? [];
  if (!origins.includes(account.origin)) throw new ManagerError('conflict');
}
