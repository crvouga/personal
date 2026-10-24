import type { WorkflowContext } from '../domain/ports.ts';
import type { Config } from '../domain/config.ts';
import type { ImportMode } from '../domain/import-merge.ts';
import { stableId } from '../domain/identity.ts';
import { ManagerError } from '../domain/errors.ts';
import { effectiveEvidence } from './decisions.ts';
import { newOperation } from './plans.ts';
import { sealDraft } from './authorization.ts';
export function migrationPlan(input: {
  context: Pick<WorkflowContext, 'state' | 'runtime'>;
  config: Config;
  evidenceId: string;
  vaultId: string | null;
  mode: ImportMode;
}) {
  const { context } = input;
  return context.state.transaction(() => {
    const evidence = effectiveEvidence(context.state).find(
      (e) => e.id === input.evidenceId
    );
    if (
      !evidence?.confirmed ||
      !evidence.origin ||
      evidence.username === null ||
      !evidence.candidateRef
    )
      throw new ManagerError('invalid-input');
    const accountId = stableId(evidence.origin, evidence.username);
    const active = context.state
      .list('operations')
      .some(
        (op) =>
          op.accountId === accountId &&
          !['completed', 'cancelled', 'failed'].includes(op.state)
      );
    if (active) throw new ManagerError('busy');
    const id = context.runtime.id();
    const op = {
      ...newOperation({
        id: stableId(id, accountId, input.evidenceId),
        planId: id,
        accountId,
        kind: 'import',
        vaultId: input.vaultId,
        evidenceId: evidence.id,
      }),
      importMode: input.mode,
    };
    context.state.put('operations', op);
    return sealDraft(context.state, {
      id,
      createdAt: context.runtime.now(),
      authorizedAt: null,
      policy: 'inspect',
      vaultIdentity: input.config.bitwarden
        ? {
            server: input.config.bitwarden.server,
            email: input.config.bitwarden.email,
          }
        : null,
      operationIds: [op.id],
      expiresAt: new Date(
        Date.parse(context.runtime.now()) +
          input.config.execution.planLifetimeHours * 3600_000
      ).toISOString(),
    });
  });
}
