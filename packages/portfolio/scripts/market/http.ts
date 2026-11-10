/**
 * HTTP for the market fetchers: a timeout, one polite retry, and plain-text
 * helpers. Job boards are third parties, so every failure is a thrown Error
 * the caller turns into "keep the cached copy", never a crash.
 */

const TIMEOUT_MS = 30_000;
const RETRY_WAIT_MS = 1500;
const USER_AGENT = 'Mozilla/5.0 (compatible; job-market-research/1.0)';

const wait = (ms: number): Promise<void> =>
  new Promise((done) => {
    setTimeout(done, ms);
  });

const once = async (url: string, init: RequestInit): Promise<unknown> => {
  const response = await fetch(url, {
    ...init,
    headers: {
      accept: 'application/json',
      'user-agent': USER_AGENT,
      ...init.headers,
    },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`${url} → HTTP ${response.status}`);
  return (await response.json()) as unknown;
};

export const getJson = async (
  url: string,
  init: RequestInit = {}
): Promise<unknown> => {
  try {
    return await once(url, init);
  } catch {
    await wait(RETRY_WAIT_MS);
    return once(url, init);
  }
};

export const postJson = (url: string, body: unknown): Promise<unknown> =>
  getJson(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

const ENTITIES: Readonly<Record<string, string>> = {
  '&nbsp;': ' ',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&#x27;': "'",
  '&#x2F;': '/',
  '&amp;': '&',
};

const decode = (text: string): string =>
  text.replace(
    /&(nbsp|lt|gt|quot|#39|#x27|#x2F|amp);/g,
    (m) => ENTITIES[m] ?? m
  );

/** HTML (possibly entity-escaped HTML) to one line of plain text. */
export const toText = (html: string): string =>
  decode(decode(html).replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();

/** Runs `task` over `items`, at most `limit` at a time, dropping failures. */
export const mapLimit = async <T, R>(
  items: readonly T[],
  limit: number,
  task: (item: T) => Promise<R>
): Promise<R[]> => {
  const results: R[] = [];
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const item = items[next++] as T;
      try {
        results.push(await task(item));
      } catch {
        // One unreachable posting must not lose the rest of its board.
      }
    }
  };
  await Promise.all(Array.from({ length: limit }, worker));
  return results;
};

type Json = Record<string, unknown>;

export const asRecord = (value: unknown): Json =>
  typeof value === 'object' && value !== null ? (value as Json) : {};

export const asArray = (value: unknown): Json[] =>
  Array.isArray(value) ? value.map(asRecord) : [];

export const str = (value: unknown): string =>
  typeof value === 'string' ? value : '';
