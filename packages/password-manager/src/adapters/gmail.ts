import type { SourceConfig } from '../domain/config.ts';
import type { DiscoveryContext, Scan } from './discovery.ts';
import { apiJson } from './http.ts';
import { ManagerError } from '../domain/errors.ts';
import { mailEvidence } from './mail-evidence.ts';
import { gmailReferences, initialGmailCursor } from './gmail-paging.ts';
const ROOT = 'https://gmail.googleapis.com';
interface Message {
  id: string;
  internalDate?: string;
  labelIds?: string[];
  payload?: { headers?: { name: string; value: string }[] };
}
export async function* scanGmail(
  source: SourceConfig,
  context: DiscoveryContext,
  cursor: string | null
): Scan {
  if (!source.tokenRef) throw new ManagerError('not-authenticated');
  const { accessToken } = JSON.parse(
    (await context.secrets.getRequired(source.tokenRef)).readSecretValue()
  ) as { accessToken: string };
  const get = <T>(path: string) =>
    apiJson<T>({
      url: ROOT + path,
      token: accessToken,
      origin: ROOT,
      fetch: context.fetch,
    });
  const snapshot = await get<{ historyId: string }>(
    '/gmail/v1/users/me/profile'
  );
  let progress = await initialGmailCursor({
    get,
    source,
    cursor,
    snapshot: snapshot.historyId,
  });
  let scanned = 0;
  for await (const ref of gmailReferences(get, source, progress)) {
    if (scanned >= source.maxMessages)
      return { cursor: JSON.stringify(progress), complete: false, scanned };
    const msg = await existingMessage(
      get,
      `/gmail/v1/users/me/messages/${encodeURIComponent(ref.id)}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Cc&metadataHeaders=Subject&metadataHeaders=Date`
    );
    scanned++;
    if (msg && inScope(msg, source)) {
      const evidence = gmailEvidence(source, context, msg);
      if (evidence) yield evidence;
    }
    progress = ref.next;
  }
  return {
    cursor: source.query ? null : progress.snapshot,
    complete: true,
    scanned,
  };
}
function inScope(msg: Message, source: SourceConfig): boolean {
  if (
    !source.includeSpamTrash &&
    msg.labelIds?.some((l) => ['SPAM', 'TRASH'].includes(l))
  )
    return false;
  const time = Number(msg.internalDate ?? 0);
  return (
    time >= Date.parse(source.after) &&
    (!source.before || time < Date.parse(source.before))
  );
}
function gmailEvidence(
  source: SourceConfig,
  context: DiscoveryContext,
  msg: Message
) {
  const headers = msg.payload?.headers ?? [];
  const header = (name: string) =>
    headers
      .filter((h) => h.name.toLowerCase() === name)
      .map((h) => h.value)
      .join(', ');
  return mailEvidence(
    source.id,
    {
      id: msg.id,
      from: addresses(header('from')),
      recipients: addresses(header('to') + ',' + header('cc')),
      subject: header('subject'),
      date: header('date'),
    },
    context.runtime.now()
  );
}
function addresses(value: string): string[] {
  return value.match(/[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9.-]+/g) ?? [];
}

async function existingMessage(
  get: <T>(path: string) => Promise<T>,
  path: string
): Promise<Message | null> {
  try {
    return await get<Message>(path);
  } catch (error) {
    if (error instanceof ManagerError && error.code === 'missing') return null;
    throw error;
  }
}
