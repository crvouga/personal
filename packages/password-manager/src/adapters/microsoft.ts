import type { SourceConfig } from '../domain/config.ts';
import type { DiscoveryContext, Scan } from './discovery.ts';
import { apiJson } from './http.ts';
import { mailEvidence } from './mail-evidence.ts';
import { ManagerError } from '../domain/errors.ts';
const ROOT = 'https://graph.microsoft.com';
interface Address {
  emailAddress?: { address?: string };
}
interface Message {
  id: string;
  subject?: string;
  from?: Address;
  toRecipients?: Address[];
  ccRecipients?: Address[];
  receivedDateTime?: string;
  parentFolderId?: string;
}
interface Page {
  value: Message[];
  '@odata.nextLink'?: string;
}
interface GraphCursor {
  version: 1;
  url: string;
  offset: number;
}
/** Full date-window polling with resumable pagination; no folder-delta claim. */
export async function* scanMicrosoft(
  source: SourceConfig,
  context: DiscoveryContext,
  saved: string | null = null
): Scan {
  if (!source.tokenRef) throw new ManagerError('not-authenticated');
  const { accessToken } = JSON.parse(
    (await context.secrets.getRequired(source.tokenRef)).readSecretValue()
  ) as { accessToken: string };
  const excluded = source.includeSpamTrash
    ? []
    : await excludedFolders(accessToken, context);
  let progress = initialCursor(source, saved);
  let scanned = 0;
  for await (const page of messagePages(context, accessToken, progress)) {
    for (let index = page.offset; index < page.value.length; index++) {
      if (scanned >= source.maxMessages)
        return { cursor: JSON.stringify(progress), complete: false, scanned };
      const message = page.value[index]!;
      scanned++;
      if (!excluded.includes(message.parentFolderId ?? '')) {
        const evidence = mailEvidence(
          source.id,
          toMetadata(message),
          context.runtime.now()
        );
        if (evidence) yield evidence;
      }
      progress = { version: 1, url: page.url, offset: index + 1 };
    }
  }
  return { cursor: null, complete: true, scanned };
}
function initialCursor(
  source: SourceConfig,
  saved: string | null
): GraphCursor {
  if (saved) {
    const cursor = JSON.parse(saved) as GraphCursor;
    if (
      cursor.version !== 1 ||
      !Number.isSafeInteger(cursor.offset) ||
      cursor.offset < 0
    )
      throw new ManagerError('invalid-input');
    return cursor;
  }
  const filter = `receivedDateTime ge ${source.after}T00:00:00Z${source.before ? ` and receivedDateTime lt ${source.before}T00:00:00Z` : ''}`;
  const params = new URLSearchParams({
    $select:
      'id,subject,from,toRecipients,ccRecipients,receivedDateTime,parentFolderId',
    $top: '100',
    $filter: filter,
  });
  return { version: 1, url: `${ROOT}/v1.0/me/messages?${params}`, offset: 0 };
}
async function* messagePages(
  context: DiscoveryContext,
  token: string,
  initial: GraphCursor
): AsyncGenerator<Page & { url: string; offset: number }> {
  let url = initial.url;
  let offset = initial.offset;
  const seen = new Set<string>();
  while (url) {
    if (seen.has(url)) throw new ManagerError('unavailable');
    seen.add(url);
    const page = await apiJson<Page>({
      url,
      token,
      origin: ROOT,
      fetch: context.fetch,
    });
    yield { ...page, url, offset };
    url = page['@odata.nextLink'] ?? '';
    offset = 0;
  }
}
function toMetadata(message: Message) {
  return {
    id: message.id,
    subject: message.subject ?? '',
    from: [message.from?.emailAddress?.address ?? ''],
    recipients: [
      ...(message.toRecipients ?? []),
      ...(message.ccRecipients ?? []),
    ].map((a) => a.emailAddress?.address ?? ''),
    date: message.receivedDateTime ?? '',
  };
}
async function excludedFolders(
  token: string,
  context: DiscoveryContext
): Promise<string[]> {
  const ids: string[] = [];
  for (const name of ['junkemail', 'deleteditems']) {
    const folder = await apiJson<{ id: string }>({
      url: `${ROOT}/v1.0/me/mailFolders/${name}?$select=id`,
      token,
      origin: ROOT,
      fetch: context.fetch,
    });
    ids.push(folder.id);
  }
  return ids;
}
