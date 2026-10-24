import { csvItems } from './csv-format.ts';
import type { SourceConfig } from '../domain/config.ts';
import type { VaultItem } from '../domain/ports.ts';
import { ManagerError } from '../domain/errors.ts';
import { stableId } from '../domain/identity.ts';
import { itemEvidence, type DiscoveryContext, type Scan } from './discovery.ts';
import { fileProgress, sourcePath } from './file-cursor.ts';
const MAX_JSON_BYTES = 32 * 1024 * 1024;
export async function* scanCsv(
  source: SourceConfig,
  context: DiscoveryContext,
  cursor: string | null = null
): Scan {
  const path = sourcePath(source.path);
  const progress = await fileProgress(path, cursor);
  let index = 0;
  let scanned = 0;
  for await (const item of csvItems(path)) {
    if (index++ < progress.offset) continue;
    if (scanned >= source.maxMessages)
      return { cursor: progress.cursor(index - 1), complete: false, scanned };
    scanned++;
    const ref = csvReference(item, index);
    yield await itemEvidence({ item, source, ref, context });
  }
  await progress.unchanged();
  return { cursor: progress.cursor(index), complete: true, scanned };
}
export async function* scanBitwardenJson(
  source: SourceConfig,
  context: DiscoveryContext,
  cursor: string | null = null
): Scan {
  const path = sourcePath(source.path);
  const progress = await fileProgress(path, cursor);
  const data = await boundedJson(path);
  validateJsonExport(data);
  let scanned = 0;
  let index = 0;
  for (const item of data['items'] as VaultItem[]) {
    if (index++ < progress.offset) continue;
    if (scanned >= source.maxMessages)
      return { cursor: progress.cursor(index - 1), complete: false, scanned };
    scanned++;
    yield await itemEvidence({
      item,
      source,
      ref: jsonReference(item, index),
      context,
    });
  }
  await progress.unchanged();
  return { cursor: progress.cursor(index), complete: true, scanned };
}
async function boundedJson(path: string): Promise<Record<string, unknown>> {
  const file = await import('node:fs/promises').then((fs) =>
    fs.open(path, 'r')
  );
  try {
    if ((await file.stat()).size > MAX_JSON_BYTES)
      throw new ManagerError('invalid-input');
    return JSON.parse(await file.readFile('utf8')) as Record<string, unknown>;
  } finally {
    await file.close();
  }
}
export async function* scanInventory(
  source: SourceConfig,
  context: DiscoveryContext
): Scan {
  if (!source.path) throw new ManagerError('invalid-config');
  const input = await boundedJson(source.path);
  const hosts = new Set<string>();
  collectHosts(input, hosts);
  let index = 0;
  for (const host of hosts) {
    const id = stableId(source.id, host);
    yield {
      id,
      sourceId: source.id,
      sourceRef: String(index++),
      observedAt: context.runtime.now(),
      category: 'inventory',
      origin: null,
      domain: host,
      username: null,
      confirmed: false,
      reasons: ['infrastructure-domain-is-not-account-proof'],
      vaultId: null,
      candidateRef: null,
      unsupported: [],
      auth: 'unknown',
    };
  }
  return { cursor: null, complete: true, scanned: index };
}
function collectHosts(value: unknown, hosts: Set<string>, depth = 0): void {
  if (depth > 30) return;
  if (isHttps(value)) {
    try {
      hosts.add(new URL(value).hostname);
    } catch {
      /* not a URL */
    }
  } else if (Array.isArray(value)) {
    for (const child of value) collectHosts(child, hosts, depth + 1);
  } else if (typeof value === 'object' && value !== null) {
    for (const child of Object.values(value))
      collectHosts(child, hosts, depth + 1);
  }
}

function isHttps(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith('https://');
}

function validateJsonExport(data: Record<string, unknown>): void {
  if (!data || !Array.isArray(data['items']) || data['encrypted'])
    throw new ManagerError('invalid-input');
}
function jsonReference(item: VaultItem, index: number): string {
  return stableId(item.id ?? String(index));
}

function csvReference(item: VaultItem, index: number): string {
  return stableId(
    String(index),
    item.login?.username ?? '',
    item.login?.uris?.[0]?.uri ?? ''
  );
}
