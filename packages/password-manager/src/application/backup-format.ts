import { z } from 'zod';
import type { SecretStore } from '@pkgs/secret-store';
import type { Config } from '../domain/config.ts';
import { parseConfig } from '../domain/config.ts';
import type { Tables } from '../domain/model.ts';
import type { StateStore, VaultItem } from '../domain/ports.ts';
import { stateTables, validateRecord } from '../domain/state-schema.ts';
import { validateVaultItems } from '../domain/vault-schema.ts';
import { ManagerError } from '../domain/errors.ts';
export interface BackupPayload {
  version: 2;
  createdAt: string;
  config: Config;
  vault: VaultItem[];
  folders?: { id: string; name: string }[];
  metadata: { [K in keyof Tables]: Tables[K][] };
  staging: Record<string, string>;
}
export function snapshotMetadata(state: StateStore): BackupPayload['metadata'] {
  return Object.fromEntries(
    stateTables.map((table) => [table, state.list(table)])
  ) as BackupPayload['metadata'];
}
export function referencedSecrets(
  metadata: BackupPayload['metadata']
): Set<string> {
  const refs = new Set<string>();
  for (const op of metadata.operations) {
    if (op.oldRef) refs.add(op.oldRef);
    if (op.stagedRef) refs.add(op.stagedRef);
  }
  for (const resolution of metadata.candidates)
    refs.add(resolution.candidateRef);
  for (const evidence of metadata.evidence)
    if (evidence.candidateRef) refs.add(evidence.candidateRef);
  return refs;
}
export function parseBackup(value: unknown): BackupPayload {
  if (!value || typeof value !== 'object')
    throw new ManagerError('invalid-input');
  const payload = value as BackupPayload;
  if (
    payload.version !== 2 ||
    typeof payload.createdAt !== 'string' ||
    !payload.metadata ||
    !payload.staging
  )
    throw new ManagerError('wrong-version');
  payload.config = parseConfig(payload.config);
  validateVaultItems(payload.vault);
  if (
    payload.folders &&
    !z
      .array(z.object({ id: z.string(), name: z.string() }))
      .safeParse(payload.folders).success
  )
    throw new ManagerError('invalid-input');
  for (const table of stateTables) validateTable(payload, table);
  validateStaging(payload);
  validateRelations(payload);
  return payload;
}
function validateTable<K extends keyof Tables>(
  payload: BackupPayload,
  table: K
): void {
  const records = payload.metadata[table];
  if (!Array.isArray(records)) throw new ManagerError('invalid-input');
  if (new Set(records.map((record) => record.id)).size !== records.length)
    throw new ManagerError('invalid-input');
  for (const record of records) validateRecord(table, record);
}
function validateRelations(payload: BackupPayload): void {
  const { operations, accounts, plans, evidence } = payload.metadata;
  for (const op of operations) {
    if (
      !accounts.some((a) => a.id === op.accountId) ||
      !plans.some((p) => p.id === op.planId)
    )
      throw new ManagerError('invalid-input');
    if (op.evidenceId && !evidence.some((e) => e.id === op.evidenceId))
      throw new ManagerError('invalid-input');
  }
}
export async function hydrateStaging(
  payload: BackupPayload,
  secrets: SecretStore
): Promise<void> {
  for (const ref of referencedSecrets(payload.metadata)) {
    const value = payload.staging[ref]!;
    const existing = await secrets.getOptional(ref);
    if (existing && existing.readSecretValue() !== value)
      throw new ManagerError('conflict');
    await secrets.setSecret(ref, value);
    if ((await secrets.getRequired(ref)).readSecretValue() !== value)
      throw new ManagerError('unavailable');
  }
}
export function hydrateMetadata(
  payload: BackupPayload,
  state: StateStore
): void {
  state.transaction(() => {
    for (const table of stateTables)
      for (const record of payload.metadata[table]) state.put(table, record);
  });
}

function validateStaging(payload: BackupPayload): void {
  for (const ref of referencedSecrets(payload.metadata)) {
    if (
      !/^[a-zA-Z0-9._/-]{1,200}$/.test(ref) ||
      typeof payload.staging[ref] !== 'string'
    )
      throw new ManagerError('invalid-input');
  }
}
