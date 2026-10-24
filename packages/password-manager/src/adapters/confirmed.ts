import { readFile, stat } from 'node:fs/promises';
import { z } from 'zod';
import type { SourceConfig } from '../domain/config.ts';
import { ManagerError } from '../domain/errors.ts';
import { originOf, stableId } from '../domain/identity.ts';
import { fileProgress } from './file-cursor.ts';
import type { DiscoveryContext, Scan } from './discovery.ts';
const accountInput = z
  .object({
    origin: z.string(),
    username: z.string().max(320),
    auth: z.enum([
      'password',
      'passkey',
      'social',
      'sso',
      'magic-link',
      'hardware-key',
      'unknown',
    ]),
    identityProvider: z.string().max(320).optional(),
  })
  .strict();
export async function* scanConfirmed(
  source: SourceConfig,
  context: DiscoveryContext,
  cursor: string | null = null
): Scan {
  if (!source.path) throw new ManagerError('invalid-config');
  if ((await stat(source.path)).size > 8 * 1024 * 1024)
    throw new ManagerError('invalid-input');
  const progress = await fileProgress(source.path, cursor);
  const parsed = z
    .array(accountInput)
    .safeParse(JSON.parse(await readFile(source.path, 'utf8')));
  if (!parsed.success) throw new ManagerError('invalid-input');
  let scanned = 0;
  let index = 0;
  for (const account of parsed.data) {
    if (index++ < progress.offset) continue;
    if (scanned >= source.maxMessages)
      return { cursor: progress.cursor(index - 1), complete: false, scanned };
    const origin = originOf(account.origin);
    if (origin !== account.origin) throw new ManagerError('invalid-input');
    const id = stableId(source.id, origin, account.username);
    scanned++;
    yield {
      id,
      sourceId: source.id,
      sourceRef: stableId(origin, account.username),
      observedAt: context.runtime.now(),
      category: 'confirmed',
      origin,
      domain: new URL(origin).hostname,
      username: account.username,
      confirmed: true,
      reasons: ['user-supplied-confirmed-account'],
      vaultId: null,
      candidateRef: null,
      unsupported: [],
      auth: account.auth,
      ...(account.identityProvider
        ? { identityProvider: account.identityProvider }
        : {}),
    };
  }
  await progress.unchanged();
  return { cursor: progress.cursor(index), complete: true, scanned };
}
