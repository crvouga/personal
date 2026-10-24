import { ImapFlow } from 'imapflow';
import type { SourceConfig } from '../domain/config.ts';
import { ManagerError } from '../domain/errors.ts';
import { mailEvidence, parseHeaders } from './mail-evidence.ts';
import type { DiscoveryContext, Scan } from './discovery.ts';
export async function* scanImap(
  source: SourceConfig,
  context: DiscoveryContext,
  cursor: string | null
): Scan {
  return yield* scanImapClient({
    source,
    context,
    cursor,
    client: await createClient(source, context),
  });
}
async function createClient(
  source: SourceConfig,
  context: DiscoveryContext
): Promise<ImapFlow> {
  if (!source.host || !source.identity || !source.credentialRef)
    throw new ManagerError('invalid-config');
  const credential = JSON.parse(
    (await context.secrets.getRequired(source.credentialRef)).readSecretValue()
  ) as { pass?: string; accessToken?: string };
  if (!credential.pass && !credential.accessToken)
    throw new ManagerError('not-authenticated');
  return new ImapFlow({
    host: source.host,
    port: source.port,
    secure: true,
    auth: { user: source.identity, ...credential },
    logger: false,
    connectionTimeout: 30_000,
    socketTimeout: 30_000,
    disableAutoIdle: true,
    maxLineLength: 1024 * 1024,
    maxLiteralSize: 64 * 1024,
    maxResponseSize: 2 * 1024 * 1024,
    maxResponseTokens: 20000,
  });
}
/** Internal fixture seam accepts an actual local protocol client. Production
 * construction above always requires TLS; no CLI/config downgrade exists. */
export async function* scanImapClient(input: {
  source: SourceConfig;
  context: DiscoveryContext;
  cursor: string | null;
  client: ImapFlow;
}): Scan {
  const { client } = input;
  try {
    await client.connect();
    const lock = await client.getMailboxLock('INBOX', { readOnly: true });
    try {
      return yield* readInbox(input);
    } finally {
      lock.release();
    }
  } catch (error) {
    if (
      error &&
      typeof error === 'object' &&
      'authenticationFailed' in error &&
      error.authenticationFailed
    )
      throw new ManagerError('not-authenticated');
    throw error;
  } finally {
    client.close();
  }
}
export async function probeImap(
  source: SourceConfig,
  context: DiscoveryContext
): Promise<void> {
  const client = await createClient(source, context);
  try {
    await client.connect();
    const lock = await client.getMailboxLock('INBOX', { readOnly: true });
    lock.release();
  } finally {
    client.close();
  }
}
async function* readInbox(input: {
  source: SourceConfig;
  context: DiscoveryContext;
  client: ImapFlow;
  cursor: string | null;
}): Scan {
  const { source, client } = input;
  if (!client.mailbox) throw new ManagerError('unavailable');
  const validity = String(client.mailbox.uidValidity);
  const end = Number(client.mailbox.uidNext) - 1;
  let highest = startUid(input.cursor, validity) - 1;
  let scanned = 0;
  for (let window = 0; window < 100 && highest < end; window++) {
    const boundary = Math.min(end, highest + 10000);
    const uids = await client.search(
      {
        uid: `${highest + 1}:${boundary}`,
        since: new Date(source.after),
        ...(source.before ? { before: new Date(source.before) } : {}),
      },
      { uid: true }
    );
    const matching = uids || [];
    const selected = selectUids(matching, {
      highest,
      boundary,
      remaining: source.maxMessages - scanned,
    });
    for await (const evidence of fetchHeaders({ ...input, uids: selected })) {
      if (evidence) yield evidence;
      scanned++;
    }
    highest = nextBoundary(selected, matching.length, boundary, highest);
    if (scanned >= source.maxMessages) break;
  }
  return {
    cursor: JSON.stringify({ validity, uid: highest }),
    complete: highest >= end,
    scanned,
  };
}
async function* fetchHeaders(input: {
  source: SourceConfig;
  context: DiscoveryContext;
  client: ImapFlow;
  uids: number[];
}) {
  if (!input.uids.length) return;
  for await (const message of input.client.fetch(
    input.uids,
    {
      uid: true,
      headers: ['from', 'to', 'cc', 'subject', 'date', 'message-id'],
    },
    { uid: true }
  )) {
    if (!message.headers || message.headers.length > 64 * 1024)
      throw new ManagerError('invalid-input');
    const mail = await parseHeaders(
      message.headers.toString('utf8'),
      String(message.uid)
    );
    yield mailEvidence(input.source.id, mail, input.context.runtime.now());
  }
}
function startUid(cursor: string | null, validity: string): number {
  const previous = cursor
    ? (JSON.parse(cursor) as { validity: string; uid: number })
    : null;
  if (previous && (!Number.isSafeInteger(previous.uid) || previous.uid < 0))
    throw new ManagerError('invalid-input');
  return previous?.validity === validity ? previous.uid + 1 : 1;
}

function selectUids(
  uids: number[],
  input: { highest: number; boundary: number; remaining: number }
): number[] {
  return uids
    .filter((uid) => uid > input.highest && uid <= input.boundary)
    .sort((a, b) => a - b)
    .slice(0, input.remaining);
}

function nextBoundary(
  selected: number[],
  available: number,
  boundary: number,
  previous: number
): number {
  return selected.length === available
    ? boundary
    : (selected.at(-1) ?? previous);
}
