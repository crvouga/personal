import type { Operation, OperationKind } from '../domain/model.ts';
import type { WorkflowContext } from '../domain/ports.ts';
import { recheckAuthDependencies } from './auth-dependencies.ts';
import { ManagerError } from '../domain/errors.ts';
import { assertAuthorized } from './authorization.ts';
import { requireAction } from './actions.ts';
import { providerPath, testedReplacement } from './auth-provider.ts';
import { transition } from './rotation-state.ts';
const supported = [
  'mfa-enroll',
  'factor-replace',
  'factor-remove',
  'passkey-enroll',
  'recovery-regenerate',
  'recovery-check',
  'delete-account',
  'review-linked',
] as const;
export function guidedKind(value: string): OperationKind {
  if (!(supported as readonly string[]).includes(value))
    throw new ManagerError('invalid-input');
  return value as OperationKind;
}
export function beginGuidedAuth(
  context: WorkflowContext,
  op: Operation
): Operation {
  requireAuthorization(context, op);
  if (op.state === 'completed') return op;
  const account = context.state.get('accounts', op.accountId);
  if (!account) throw new ManagerError('missing');
  testedReplacement(context.state, op);
  const destination = officialDestination(account.origin, op.kind);
  const providerInstructions = providerPath(account, op);
  if (!op.submittedAt && !['recovery-check', 'review-linked'].includes(op.kind))
    op = transition(
      context,
      { ...op, submittedAt: context.runtime.now() },
      'change_submitting'
    );
  requireAction(context.state, {
    accountId: account.id,
    sourceId: null,
    operationId: op.id,
    runId: op.runId,
    step: op.kind,
    reason: 'provider-authentication-or-hardware-interaction-required',
    destination,
    instructions: [
      ...providerInstructions,
      ...instructions(op),
      ...(op.targetFactor
        ? [
            `Act only on the exact factor label: ${op.targetFactor}. Keep the tested replacement ${op.replacementOperationId ?? 'recorded separately'} intact.`,
          ]
        : []),
    ],
    prerequisites: [
      'Keep an independently usable recovery route.',
      'Replacement factors must pass an actual sign-in test before removing an old factor.',
    ],
    expiresAt: null,
    detection:
      'Record user attestation after testing the factor/recovery route. No independent verification is claimed.',
    resume: `bun run password-manager auth attest ${op.id} --tested`,
    alternative:
      'Keep this action pending and use the provider support/recovery flow. Never regenerate again after an ambiguous response.',
  });
  return transition(
    context,
    { ...op, resumeState: op.state },
    'requires_user_action'
  );
}
function officialDestination(origin: string, kind: OperationKind): string {
  if (origin === 'https://github.com')
    return kind === 'delete-account'
      ? origin + '/settings/admin'
      : origin + '/settings/security';
  if (origin === 'https://accounts.google.com')
    return kind === 'review-linked'
      ? 'https://myaccount.google.com/connections'
      : kind === 'delete-account'
        ? 'https://myaccount.google.com/deleteaccount'
        : 'https://myaccount.google.com/security';
  if (origin === 'https://account.apple.com')
    return 'https://account.apple.com/account/manage';
  throw new ManagerError('unsupported-capability');
}
function instructions(op: Operation): string[] {
  const common = [
    '1. Open the official destination and sign in to the selected account. Verify the account identity before changing authentication.',
    '2. Keep existing factors and recovery routes until the replacement has passed a fresh sign-in test.',
  ];
  if (op.kind === 'recovery-regenerate')
    return [
      ...common,
      '3. Regenerate recovery codes once. This may invalidate old codes. If the response is lost, keep outcome unknown and recover through the provider; do not regenerate blindly.',
      `4. Capture the newly issued codes immediately using bun run password-manager auth capture ${op.id} --stdin from protected input. They go to the OS credential store.`,
      '5. Verify the provider displays the new recovery set, preserve an independent offline copy, then run the exact resume command.',
    ];
  if (op.kind === 'passkey-enroll')
    return [
      ...common,
      '3. Under Passkeys/Security keys choose Add, name the new credential, and complete the OS/security-key biometric or physical-touch dialog.',
      '4. Sign out and authenticate with the new credential. CSV export does not transfer a hardware credential; keep the previous credential until the test succeeds.',
    ];
  if (op.kind === 'mfa-enroll' || op.kind === 'factor-replace')
    return [
      ...common,
      '3. Under Two-factor authentication choose your existing authenticator strategy. Scan the QR with that authenticator or touch the selected security key; complete the verification challenge.',
      '4. Save issued recovery codes securely before continuing. Sign out and test the new factor in a fresh sign-in; retain the previous factor.',
    ];
  if (op.kind === 'recovery-check')
    return [
      ...common,
      '3. Confirm access to the recovery email/phone and check which other identity accounts they depend on. Keep a tested authenticator and recovery route independent of this vault.',
      '4. Prepare an emergency sheet offline: exact vault region/account, master-password recovery strategy, authenticator backup location, independent backup password and encrypted backup location. Do not enter those values into workflow metadata.',
      '5. On a separate trusted device, prove that you can locate and decrypt the independent backup and access the chosen recovery route. Attest only the checks you actually performed; provider recovery is not independently verified by this tool.',
    ];
  return [
    ...common,
    `3. Perform only the selected action: ${op.kind}. Record completion with the resume command only after checking its actual result.`,
  ];
}
export async function captureIssuedMaterial(
  context: WorkflowContext,
  id: string,
  material: string
): Promise<Operation> {
  const op = context.state.get('operations', id);
  if (
    !op ||
    !op.submittedAt ||
    op.state === 'completed' ||
    op.kind !== 'recovery-regenerate' ||
    !material ||
    material.length > 64 * 1024
  )
    throw new ManagerError('invalid-input');
  requireAuthorization(context, op);
  const ref = `operation/${op.id}/issued-recovery`;
  const previous = await context.secrets.getOptional(ref);
  if (previous && previous.readSecretValue() !== material)
    throw new ManagerError('conflict');
  await context.secrets.setSecret(ref, material);
  if ((await context.secrets.getRequired(ref)).readSecretValue() !== material)
    throw new ManagerError('unavailable');
  return transition(context, { ...op, stagedRef: ref }, 'change_confirmed');
}
export function attestGuided(context: WorkflowContext, id: string): Operation {
  const op = context.state.get('operations', id);
  if (!op || !(supported as readonly string[]).includes(op.kind))
    throw new ManagerError('invalid-input');
  if (!['requires_user_action', 'change_confirmed'].includes(op.state))
    throw new ManagerError('requires-user-action');
  testedReplacement(context.state, op);
  if (op.kind === 'recovery-regenerate' && !op.stagedRef)
    throw new ManagerError('requires-user-action');
  requireAuthorization(context, op);
  const account = context.state.get('accounts', op.accountId)!;
  const isMfa = ['mfa-enroll', 'factor-replace'].includes(op.kind);
  context.state.put('accounts', {
    ...account,
    ...(isMfa ? { mfa: 'user-attested' as const } : {}),
    ...(['recovery-check', 'recovery-regenerate'].includes(op.kind)
      ? { recovery: 'user-attested' as const }
      : {}),
  });
  for (const action of context.state
    .list('actions')
    .filter((a) => a.operationId === id))
    context.state.put('actions', {
      ...action,
      status: 'resolved',
      attestation: 'user',
    });
  if (!['recovery-check', 'review-linked'].includes(op.kind))
    recheckAuthDependencies(context, op);
  // completed means the selected guided workflow was user-attested; verifiedAt
  // deliberately remains null and no credential is marked independently verified.
  return transition(
    context,
    { ...op, completedAt: context.runtime.now(), verifiedAt: null },
    'completed'
  );
}

function requireAuthorization(context: WorkflowContext, op: Operation): void {
  assertAuthorized(context.state, op, context.runtime, context.vaultIdentity);
}
