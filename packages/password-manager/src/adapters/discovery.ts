import { ManagerError } from '../domain/errors.ts';
import type { SecretStore } from '@pkgs/secret-store';
import type { SourceConfig } from '../domain/config.ts';
import type { Evidence } from '../domain/model.ts';
import type { Runtime, Vault, VaultItem } from '../domain/ports.ts';
import { originOf, stableId } from '../domain/identity.ts';
export interface ScanResult {
  cursor: string | null;
  complete: boolean;
  scanned: number;
}
export interface DiscoveryContext {
  secrets: SecretStore;
  runtime: Runtime;
  vault: Vault | null;
  fetch: typeof fetch;
}
export type Scan = AsyncGenerator<Evidence, ScanResult>;
export async function itemEvidence(input: {
  item: VaultItem;
  source: SourceConfig;
  ref: string;
  context: DiscoveryContext;
}): Promise<Evidence> {
  const { item, source, ref, context } = input;
  const id = stableId(source.id, ref);
  const uri = itemOrigin(item);
  const candidateRef = source.kind === 'bitwarden' ? null : `candidate/${id}`;
  if (candidateRef) await stageCandidate(context, candidateRef, item);
  const unsupported = unsupportedFields(item);
  return {
    id,
    sourceId: source.id,
    sourceRef: ref,
    observedAt: context.runtime.now(),
    category: source.kind === 'bitwarden' ? 'vault' : 'export',
    origin: uri,
    domain: uri ? new URL(uri).hostname : null,
    username: item.login?.username ?? null,
    confirmed: uri !== null && item.type === 1,
    reasons: ['user-selected-credential-source'],
    ...vaultReference(item, source),
    candidateRef,
    unsupported,
    auth: itemAuth(item),
  };
}
function unsupportedFields(item: VaultItem): string[] {
  const fields: string[] = [];
  if (item.type !== 1) fields.push('non-login-item-use-native-transfer');
  if (Array.isArray(item['_unsupported']))
    fields.push(
      ...(item['_unsupported'] as unknown[]).filter(
        (value): value is string =>
          value === 'csv-custom-fields-require-json-export'
      )
    );
  if (item.login?.fido2Credentials?.length)
    fields.push('passkeys-use-supported-credential-exchange');
  if (Array.isArray(item['attachments']) && item['attachments'].length)
    fields.push('attachments-copy-separately');
  if (item.organizationId)
    fields.push('shared-ownership-requires-explicit-destination');
  if (item['folderId'])
    fields.push('folder-reference-requires-destination-mapping');
  return fields;
}
export async function* scanVault(
  source: SourceConfig,
  context: DiscoveryContext,
  cursor: string | null = null
): Scan {
  if (!context.vault) throw new ManagerError('not-authenticated');
  const items = (await context.vault.list()).filter((item) =>
    vaultScope(item, source)
  );
  const snapshot = stableId(
    JSON.stringify(items.map((item) => [item.id, item.revisionDate]))
  );
  const progress = vaultProgress(snapshot, cursor);
  let scanned = 0;
  for (let index = progress.offset; index < items.length; index++) {
    if (scanned >= source.maxMessages)
      return { cursor: progress.cursor(index), complete: false, scanned };
    const item = items[index]!;
    scanned++;
    yield await itemEvidence({ item, source, ref: item.id, context });
  }
  return { cursor: progress.cursor(items.length), complete: true, scanned };
}

function itemOrigin(item: VaultItem): string | null {
  return (
    item.login?.uris?.map((u) => originOf(u.uri)).find((u) => u !== null) ??
    null
  );
}
function itemAuth(item: VaultItem): Evidence['auth'] {
  if (item.login?.password) return 'password';
  return item.login?.fido2Credentials?.length ? 'passkey' : 'unknown';
}

async function stageCandidate(
  context: DiscoveryContext,
  ref: string,
  item: VaultItem
): Promise<void> {
  const existing = await context.secrets.getOptional(ref);
  if (existing && existing.readSecretValue() !== JSON.stringify(item)) {
    throw new ManagerError('conflict');
  }
  if (!existing) await context.secrets.setSecret(ref, JSON.stringify(item));
}

function vaultScope(item: VaultItem, source: SourceConfig): boolean {
  return item.type === 1 && (!item.organizationId || source.includeShared);
}
function vaultProgress(snapshot: string, cursor: string | null) {
  const value = cursor
    ? (JSON.parse(cursor) as { snapshot: string; offset: number })
    : null;
  const offset = value?.snapshot === snapshot ? value.offset : 0;
  if (!Number.isSafeInteger(offset) || offset < 0)
    throw new ManagerError('invalid-input');
  return {
    offset,
    cursor: (next: number) => JSON.stringify({ snapshot, offset: next }),
  };
}

function vaultReference(item: VaultItem, source: SourceConfig) {
  return source.kind === 'bitwarden'
    ? { vaultId: item.id, vaultRevision: item.revisionDate ?? null }
    : { vaultId: null, vaultRevision: null };
}
