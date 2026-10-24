import type { Operation, OperationState } from '../domain/model.ts';
import type { WorkflowContext, Credential } from '../domain/ports.ts';
import { ManagerError } from '../domain/errors.ts';
import { operationAction, requireAction } from './actions.ts';
export function transition(
  context: WorkflowContext,
  op: Operation,
  state: OperationState
): Operation {
  const updated = { ...op, state, error: null };
  context.state.transaction(() => {
    context.state.put('operations', updated);
    context.state.put('events', {
      id: context.runtime.id(),
      at: context.runtime.now(),
      operationId: op.id,
      state,
    });
  });
  if (state === 'reconciliation_required')
    reconciliationAction(context, updated);
  context.checkpoint?.(state);
  return updated;
}
export async function credentials(
  context: WorkflowContext,
  op: Operation
): Promise<{ old: Credential; replacement: string }> {
  if (!op.oldRef || !op.stagedRef) throw new ManagerError('missing');
  return {
    old: JSON.parse(
      (await context.secrets.getRequired(op.oldRef)).readSecretValue()
    ) as Credential,
    replacement: (
      await context.secrets.getRequired(op.stagedRef)
    ).readSecretValue(),
  };
}
export function pause(
  context: WorkflowContext,
  op: Operation,
  step: string
): Operation {
  const account = context.state.get('accounts', op.accountId);
  if (!account) throw new ManagerError('missing');
  requireAction(
    context.state,
    operationAction({
      operationId: op.id,
      accountId: op.accountId,
      runId: op.runId,
      step,
      destination:
        account.origin === 'https://github.com'
          ? account.origin + '/settings/security'
          : account.origin,
      reason: step,
      instructions:
        step === 'unsupported-capability'
          ? [
              '1. This origin has no maintained automated password adapter in the installed release. No browser was opened and no password change was submitted.',
              `2. Open the confirmed service origin ${account.origin} using its native account/security settings and review its supported authentication methods. Do not create a password for SSO/passkey-only access.`,
              '3. Keep this operation pending or discard its unsent plan with plan discard PLAN_ID. Use the official native workflow if necessary, update the selected vault item deliberately, and rediscover the vault. A manual change is not independently verified by this adapter.',
              '4. Upgrading with a fixture-tested adapter for this exact origin permits recover to recheck the same selected operation. Independent supported accounts can continue.',
            ]
          : [
              '1. Run the resume command from a terminal on the machine holding this operation.',
              '2. Complete the provider challenge in the dedicated password-manager browser window. Keep existing factors enabled.',
              '3. Resume again; the adapter rechecks the outcome using the same staged credential. Do not repeat an ambiguous password change manually.',
              `4. If the vault conflicts after a confirmed remote change, use the OS credential-store UI: service ${context.secretService ?? 'workspace.password-manager'}, entry ${op.stagedRef ?? 'not-staged'}. Restore only this operation’s staged password in the selected Bitwarden item, then run recover. Keep all unrelated item fields. Never paste this secret into logs or reports.`,
            ],
    })
  );
  const updated = {
    ...op,
    resumeState: op.state,
    state: 'requires_user_action' as const,
  };
  context.state.put('operations', updated);
  return updated;
}

function reconciliationAction(context: WorkflowContext, op: Operation): void {
  const account = context.state.get('accounts', op.accountId);
  if (!account) return;
  requireAction(
    context.state,
    operationAction({
      operationId: op.id,
      accountId: op.accountId,
      runId: op.runId,
      step: 'reconciliation',
      destination: account.origin,
      reason: 'website-and-vault-outcome-requires-reconciliation',
      instructions: [
        '1. Leave the old and staged OS credentials intact. Do not submit another password change.',
        `2. Inspect this operation with bun run password-manager status. The protected replacement is at OS credential service ${context.secretService ?? 'workspace.password-manager'}, entry ${op.stagedRef ?? 'not-staged'}.`,
        '3. If a concurrent Bitwarden edit changed its password, resolve that conflict in the vault using the already-active staged credential; preserve unrelated fields.',
        '4. Run the exact resume command. It independently tests the staged credential and rereads the current vault. Uncertain results remain pending.',
      ],
    })
  );
}
