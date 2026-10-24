import type { WorkflowContext, VaultItem } from '../domain/ports.ts';
import { ManagerError } from '../domain/errors.ts';
import { effectiveEvidence } from './decisions.ts';
import { stableId } from '../domain/identity.ts';
export async function configureImport(
  context: WorkflowContext,
  input: { evidenceId: string; folderId?: string; personal?: boolean }
): Promise<void> {
  const evidence = effectiveEvidence(context.state).find(
    (e) => e.id === input.evidenceId
  );
  if (!evidence?.candidateRef || (!input.folderId && !input.personal))
    throw new ManagerError('invalid-input');
  const active = context.state
    .list('operations')
    .some(
      (op) =>
        op.evidenceId === evidence.id &&
        !['completed', 'cancelled', 'failed'].includes(op.state)
    );
  if (active) throw new ManagerError('busy');
  await verifyFolder(context, input.folderId);
  const candidate = JSON.parse(
    (await context.secrets.getRequired(evidence.candidateRef)).readSecretValue()
  ) as VaultItem;
  const selected = {
    ...candidate,
    ...(input.folderId
      ? { folderId: input.folderId === 'none' ? null : input.folderId }
      : {}),
    ...(input.personal ? { organizationId: null, collectionIds: [] } : {}),
  };
  const ref = `candidate/${stableId(evidence.id, context.runtime.id())}`;
  await context.secrets.setSecret(ref, JSON.stringify(selected));
  const unsupported = evidence.unsupported.filter(
    (reason) => !resolved(reason, input)
  );
  const originalRef = context.state.get('evidence', evidence.id)!.candidateRef!;
  context.state.put('candidates', {
    id: evidence.id,
    originalRef,
    candidateRef: ref,
    unsupported,
    createdAt: context.runtime.now(),
  });
}
function resolved(
  reason: string,
  input: { folderId?: string; personal?: boolean }
): boolean {
  if (reason === 'folder-reference-requires-destination-mapping')
    return Boolean(input.folderId);
  return (
    reason === 'shared-ownership-requires-explicit-destination' &&
    Boolean(input.personal)
  );
}

async function verifyFolder(
  context: WorkflowContext,
  folderId: string | undefined
): Promise<void> {
  if (!folderId || folderId === 'none') return;
  if (!context.vault.folder) throw new ManagerError('unavailable');
  await context.vault.folder(folderId);
}
