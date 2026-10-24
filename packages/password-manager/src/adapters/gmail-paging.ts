import type { SourceConfig } from '../domain/config.ts';
import { ManagerError } from '../domain/errors.ts';
export interface GmailCursor {
  version: 1;
  mode: 'search' | 'history';
  startHistory: string;
  snapshot: string;
  page: string;
  offset: number;
}
interface Page {
  messages?: { id: string }[];
  nextPageToken?: string;
}
interface HistoryPage {
  history?: { messagesAdded?: { message: { id: string } }[] }[];
  nextPageToken?: string;
}
export type GmailGet = <T>(path: string) => Promise<T>;
export async function initialGmailCursor(input: {
  get: GmailGet;
  source: SourceConfig;
  cursor: string | null;
  snapshot: string;
}): Promise<GmailCursor> {
  if (input.cursor?.startsWith('{')) return parseCursor(input.cursor);
  const current: GmailCursor = {
    version: 1,
    mode: 'search',
    startHistory: input.cursor ?? '',
    snapshot: input.snapshot,
    page: '',
    offset: 0,
  };
  if (!input.cursor || input.source.query) return current;
  try {
    await input.get<HistoryPage>(
      `/gmail/v1/users/me/history?startHistoryId=${encodeURIComponent(input.cursor)}&maxResults=1`
    );
    return { ...current, mode: 'history' };
  } catch (error) {
    if (error instanceof ManagerError && error.code === 'missing')
      return current;
    throw error;
  }
}
function parseCursor(value: string): GmailCursor {
  const parsed = JSON.parse(value) as GmailCursor;
  if (
    parsed.version !== 1 ||
    !['search', 'history'].includes(parsed.mode) ||
    !Number.isSafeInteger(parsed.offset) ||
    parsed.offset < 0
  )
    throw new ManagerError('invalid-input');
  return parsed;
}
export async function* gmailReferences(
  get: GmailGet,
  source: SourceConfig,
  initial: GmailCursor
): AsyncGenerator<{ id: string; next: GmailCursor }> {
  let cursor = initial;
  const seen = new Set<string>();
  for (;;) {
    if (seen.has(cursor.page)) throw new ManagerError('unavailable');
    seen.add(cursor.page);
    const page = await readPage(get, source, cursor);
    const messages = pageMessages(page, cursor.mode);
    for (let index = cursor.offset; index < messages.length; index++) {
      yield { id: messages[index]!.id, next: { ...cursor, offset: index + 1 } };
    }
    if (!page.nextPageToken) return;
    cursor = { ...cursor, page: page.nextPageToken, offset: 0 };
  }
}
function pageMessages(
  page: Page & HistoryPage,
  mode: string
): { id: string }[] {
  if (mode === 'search') return page.messages ?? [];
  return (page.history ?? []).flatMap((h) =>
    (h.messagesAdded ?? []).map((a) => a.message)
  );
}
function pagePath(source: SourceConfig, cursor: GmailCursor): string {
  const paging = {
    maxResults: '500',
    ...(cursor.page ? { pageToken: cursor.page } : {}),
  };
  if (cursor.mode === 'history')
    return `/gmail/v1/users/me/history?${new URLSearchParams({ ...paging, startHistoryId: cursor.startHistory, historyTypes: 'messageAdded' })}`;
  const q = `after:${source.after} ${source.before ? `before:${source.before}` : ''} ${source.query}`;
  return `/gmail/v1/users/me/messages?${new URLSearchParams({ ...paging, q, includeSpamTrash: String(source.includeSpamTrash) })}`;
}

async function readPage(
  get: GmailGet,
  source: SourceConfig,
  cursor: GmailCursor
): Promise<Page & HistoryPage> {
  try {
    return await get<Page & HistoryPage>(pagePath(source, cursor));
  } catch (error) {
    if (
      error instanceof ManagerError &&
      error.code === 'missing' &&
      cursor.mode === 'history'
    )
      throw new ManagerError('stale-cursor');
    throw error;
  }
}
