import { z } from 'zod';
import type { Tables } from './model.ts';
import { errorCodes, ManagerError } from './errors.ts';
const text = z.string();
const nullable = text.nullable();
const refs = z.array(text);
const auth = z.enum([
  'password',
  'passkey',
  'social',
  'sso',
  'magic-link',
  'hardware-key',
  'unknown',
]);
const opState = z.enum([
  'planned',
  'prerequisites_ready',
  'credential_staged',
  'change_submitting',
  'change_confirmed',
  'vault_updated',
  'login_verified',
  'completed',
  'requires_user_action',
  'outcome_unknown',
  'reconciliation_required',
  'failed',
  'cancelled',
]);
const kind = z.enum([
  'import',
  'rotate',
  'mfa-enroll',
  'factor-replace',
  'factor-remove',
  'passkey-enroll',
  'recovery-regenerate',
  'recovery-check',
  'delete-account',
  'delete-vault-item',
  'review-linked',
]);
const importMode = z.enum([
  'create',
  'merge-metadata',
  'replace-password',
  'preserve',
]);
const scope = z
  .object({
    targetFactor: z.string().min(1).max(100).nullable().optional(),
    replacementOperationId: nullable.optional(),
    importMode,
    operationId: text,
    accountId: text,
    origin: text,
    username: text,
    auth,
    kind,
    vaultId: nullable,
    evidenceId: nullable,
    candidateRef: nullable,
  })
  .strict();
export const stateSchemas = {
  maintenance: z
    .object({
      id: text,
      at: text,
      status: text,
      pendingActions: z.number().int().nonnegative(),
      backupFresh: z.boolean(),
      capabilityDigest: text,
      notificationDigest: text,
    })
    .strict(),
  candidates: z
    .object({
      id: text,
      originalRef: text,
      candidateRef: text,
      unsupported: refs,
      createdAt: text,
    })
    .strict(),
  backups: z
    .object({
      id: text,
      createdAt: text,
      digest: text,
      verifiedAt: nullable,
      vaultItems: z.number().int().nonnegative(),
    })
    .strict(),
  evidence: z
    .object({
      vaultRevision: nullable.optional(),
      id: text,
      sourceId: text,
      sourceRef: text,
      observedAt: text,
      category: z.enum([
        'vault',
        'export',
        'registration',
        'verification',
        'reset',
        'change',
        'security',
        'billing',
        'inventory',
        'confirmed',
      ]),
      origin: nullable,
      domain: nullable,
      username: nullable,
      confirmed: z.boolean(),
      reasons: refs,
      vaultId: nullable,
      candidateRef: nullable,
      unsupported: refs,
      auth,
      identityProvider: text.optional(),
    })
    .strict(),
  accounts: z
    .object({
      credentialRevision: nullable.optional(),
      credentialVerifiedAt: nullable.optional(),
      id: text,
      origin: text,
      username: text,
      confirmed: z.boolean(),
      auth,
      identityProvider: nullable,
      evidenceIds: refs,
      vaultIds: refs,
      credential: z.enum(['unknown', 'stored', 'verified', 'stale']),
      recovery: z.enum(['unknown', 'user-attested', 'verified']),
      mfa: z.enum(['unknown', 'user-attested', 'verified']),
      priority: z.number(),
    })
    .strict(),
  operations: z
    .object({
      id: text,
      planId: text,
      runId: nullable,
      accountId: text,
      kind,
      state: opState,
      resumeState: opState.nullable(),
      vaultId: nullable,
      evidenceId: nullable,
      stagedRef: nullable,
      oldRef: nullable,
      expectedRevision: nullable,
      submittedAt: nullable,
      verifiedAt: nullable,
      completedAt: nullable,
      attempts: z.number().int().nonnegative(),
      error: z.enum(errorCodes).nullable(),
      importMode: importMode.optional(),
      replacementOperationId: nullable.optional(),
      targetFactor: z.string().min(1).max(100).nullable().optional(),
    })
    .strict(),
  plans: z
    .object({
      id: text,
      createdAt: text,
      operationIds: refs,
      authorizedAt: nullable,
      expiresAt: text,
      policy: z.enum(['inspect', 'selected']),
      vaultIdentity: z
        .object({ server: text, email: text })
        .strict()
        .nullable()
        .optional(),
      scope: z.array(scope).optional(),
      issues: z
        .array(
          z
            .object({
              accountId: text,
              evidenceId: text,
              reason: z.enum([
                'unsupported-transfer-fields',
                'conflicting-import-candidates',
                'existing-vault-credential-preserved',
              ]),
            })
            .strict()
        )
        .optional(),
    })
    .strict(),
  actions: z
    .object({
      id: text,
      accountId: nullable,
      sourceId: nullable,
      operationId: nullable,
      runId: nullable,
      step: text,
      reason: text,
      destination: nullable,
      instructions: refs,
      prerequisites: refs,
      expiresAt: nullable,
      detection: text,
      resume: text,
      alternative: text,
      status: z.enum(['pending', 'resolved', 'skipped']),
      attestation: z.enum(['none', 'user']),
    })
    .strict(),
  runs: z
    .object({
      id: text,
      createdAt: text,
      planId: nullable,
      state: z.enum([
        'running',
        'completed',
        'requires-user-action',
        'partial',
        'failed',
        'cancelled',
      ]),
      cancelled: z.boolean(),
    })
    .strict(),
  coverage: z
    .object({
      id: text,
      state: z.enum([
        'configured',
        'connected',
        'scanned',
        'incomplete',
        'skipped',
        'unsupported',
        'failed',
        'requires-user-action',
      ]),
      scanned: z.number().int().nonnegative(),
      discovered: z.number().int().nonnegative(),
      lastSuccess: nullable,
      cursor: nullable,
      filters: text,
      error: z.enum(errorCodes).nullable(),
    })
    .strict(),
  events: z
    .object({ id: text, at: text, operationId: text, state: opState })
    .strict(),
  decisions: z
    .object({
      id: text,
      evidenceId: text,
      origin: text,
      username: text,
      auth,
      identityProvider: nullable,
      active: z.boolean(),
      createdAt: text,
      previousId: nullable,
    })
    .strict(),
  imports: z
    .object({
      id: text,
      sourceId: text,
      sourceRef: text,
      vaultId: text,
      operationId: text,
      verifiedAt: text,
      status: z.enum(['imported', 'updated', 'preserved']).optional(),
    })
    .strict(),
} satisfies Record<keyof Tables, z.ZodType>;
export const stateTables = Object.keys(stateSchemas) as (keyof Tables)[];
export function validateRecord<K extends keyof Tables>(
  table: K,
  value: unknown
): Tables[K] {
  if (!stateSchemas[table].safeParse(value).success)
    throw new ManagerError('invalid-input');
  return value as Tables[K];
}
