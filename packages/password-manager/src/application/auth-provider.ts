import type { Account, Operation } from '../domain/model.ts';
import type { StateStore } from '../domain/ports.ts';
import { ManagerError } from '../domain/errors.ts';
export function testedReplacement(state: StateStore, op: Operation): void {
  if (op.kind !== 'factor-remove') return;
  if (!op.targetFactor) throw new ManagerError('requires-user-action');
  const replacement = state.get('operations', op.replacementOperationId ?? '');
  const attested = state
    .list('actions')
    .some(
      (a) =>
        a.operationId === replacement?.id &&
        a.status === 'resolved' &&
        a.attestation === 'user'
    );
  if (
    !replacement ||
    replacement.targetFactor === op.targetFactor ||
    replacement.accountId !== op.accountId ||
    !['mfa-enroll', 'factor-replace'].includes(replacement.kind) ||
    replacement.state !== 'completed' ||
    !attested
  )
    throw new ManagerError('requires-user-action');
}
export function providerPath(account: Account, op: Operation): string[] {
  if (op.kind === 'review-linked')
    return [
      '1. Google: open https://myaccount.google.com/connections and inspect the selected account’s third-party connections. Apple: account.apple.com > Sign-In and Security > Sign in with Apple.',
      '2. Review each service and its exact username/alias in the native account UI. Record confirmed accounts with accounts confirm or accounts confirm-batch using auth=social and identityProvider set to this provider. A connection is not proof of a standalone password.',
      '3. Do not revoke a connection during this read-only review. Revocation needs a separately selected action and recovery review.',
    ];
  if (account.origin === 'https://github.com')
    return [
      'GitHub: Settings > Password and authentication. Check the displayed username against the selected account.',
      op.kind === 'recovery-regenerate'
        ? 'Recovery codes > View > Generate new recovery codes. If already issued, use View to retrieve the current set; do not generate again.'
        : 'Two-factor authentication > Edit for the chosen authenticator/security key, or Passkeys > Add a passkey. Select only the action named in this plan.',
    ];
  if (account.origin === 'https://accounts.google.com')
    return [
      'Google Account > Security & sign-in > How you sign in to Google > 2-Step Verification (or Passkeys and security keys). Check the selected email.',
      'For backup codes: Backup codes > Continue. Get codes/Refresh invalidates the previous set. After an interruption inspect the existing set; do not refresh again.',
    ];
  if (account.origin === 'https://account.apple.com')
    return [
      'On the trusted Mac: System Settings > your name > Sign-In & Security. Verify the Apple Account address. Use Two-Factor Authentication for security keys.',
      'For Recovery Key: select Recovery Key, print/write the key outside iCloud and complete the confirmation. Enabling it changes the recovery model; review https://support.apple.com/en-us/109345 first. Do not replace it again after an ambiguous result.',
    ];
  throw new ManagerError('unsupported-capability');
}
