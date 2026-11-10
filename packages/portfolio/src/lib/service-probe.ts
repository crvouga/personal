/**
 * For `/index/`: what a host serves right now, from one GET of its URL at build time.
 *
 * - `live`: a page anyone can open.
 * - `gated`: up, but asks for sign-in first (401/403, or a redirect to a
 *   login path).
 * - `parked`: up, but a registrar or "coming soon" placeholder.
 * - `down`: no answer, a TLS or DNS failure, an error status, or a redirect
 *   loop. A down host is never presented as a working link.
 */

export const STATUSES = ['live', 'gated', 'parked', 'down'] as const;
export type Status = (typeof STATUSES)[number];

export type Probe = {
  readonly status: Status;
  /** Last HTTP status seen; null when the request never got an answer. */
  readonly httpStatus: number | null;
  /** Where the redirects ended. */
  readonly finalUrl: string;
  readonly pageTitle: string | null;
  readonly pageDescription: string | null;
  /** Why, in a few words, for the card's tooltip and the build log. */
  readonly detail: string;
};

export type Fetcher = (url: string, init: RequestInit) => Promise<Response>;

const MAX_REDIRECTS = 6;
const MAX_BODY_BYTES = 256 * 1024;
export const PROBE_TIMEOUT_MS = 8_000;

const USER_AGENT =
  'Mozilla/5.0 (compatible; chrisvouga-index/1.0; +https://www.chrisvouga.dev/index/)';

const LOGIN_PATH =
  /\/(login|log-in|signin|sign-in|auth|sso|oauth2?|cdn-cgi\/access)(\/|$|\?|#)/i;

const PARKED_TITLE =
  /coming soon|website expired|domain (is )?(for sale|parked)|parked (free|domain)|under construction|this domain/i;

const ENTITIES: Readonly<Record<string, string>> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&#x27;': "'",
  '&nbsp;': ' ',
};

const decode = (text: string): string =>
  text
    .replace(
      /&(amp|lt|gt|quot|nbsp|#39|#x27);/g,
      (match) => ENTITIES[match] ?? match
    )
    .replace(/\s+/g, ' ')
    .trim();

const clean = (text: string | undefined): string | null => {
  if (text === undefined) return null;
  const value = decode(text);
  return value === '' ? null : value.slice(0, 240);
};

export const pageTitleOf = (html: string): string | null =>
  clean(/<title[^>]*>([^<]*)<\/title>/i.exec(html)?.[1]);

const metaContent = (html: string, name: string): string | undefined => {
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    const key = /\b(?:name|property)\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1];
    if (key?.toLowerCase() !== name) continue;
    const content = /\bcontent\s*=\s*"([^"]*)"|\bcontent\s*=\s*'([^']*)'/i.exec(
      tag
    );
    return content?.[1] ?? content?.[2];
  }
  return undefined;
};

export const pageDescriptionOf = (html: string): string | null =>
  clean(
    metaContent(html, 'description') ?? metaContent(html, 'og:description')
  );

const readText = async (response: Response): Promise<string> => {
  const type = response.headers.get('content-type') ?? '';
  if (!type.includes('html') || response.body === null) {
    await response.body?.cancel();
    return '';
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (size < MAX_BODY_BYTES) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.byteLength;
  }
  await reader.cancel();
  return new TextDecoder().decode(Buffer.concat(chunks));
};

const down = (
  finalUrl: string,
  httpStatus: number | null,
  detail: string
): Probe => ({
  status: 'down',
  httpStatus,
  finalUrl,
  pageTitle: null,
  pageDescription: null,
  detail,
});

const codeOf = (error: unknown): string | null => {
  if (!(error instanceof Error)) return null;
  if ('code' in error && typeof error.code === 'string') return error.code;
  return error.cause === undefined ? null : codeOf(error.cause);
};

/** Node wraps network failures in `TypeError: fetch failed` with a coded cause. */
const errorDetail = (error: unknown): string => {
  if (error instanceof Error && error.name === 'TimeoutError')
    return 'no answer (timed out)';
  const code = codeOf(error);
  return code === null ? 'no answer' : `no answer (${code})`;
};

const gated = (
  finalUrl: string,
  httpStatus: number | null,
  detail: string
): Probe => ({
  status: 'gated',
  httpStatus,
  finalUrl,
  pageTitle: null,
  pageDescription: null,
  detail,
});

const isLoginUrl = (url: string): boolean => {
  const { pathname, search } = new URL(url);
  return LOGIN_PATH.test(pathname + search);
};

/** A 2xx page: live, unless its title says it is a placeholder. */
const fromPage = async (response: Response, url: string): Promise<Probe> => {
  let html = '';
  try {
    html = await readText(response);
  } catch (error) {
    return down(url, response.status, errorDetail(error));
  }
  const pageTitle = pageTitleOf(html);
  const parked = pageTitle !== null && PARKED_TITLE.test(pageTitle);
  return {
    status: parked ? 'parked' : 'live',
    httpStatus: response.status,
    finalUrl: url,
    pageTitle,
    pageDescription: pageDescriptionOf(html),
    detail: parked
      ? `placeholder page (“${pageTitle ?? ''}”)`
      : `HTTP ${String(response.status)}`,
  };
};

/** One response: a final verdict, or the URL to follow next. */
const classify = async (
  response: Response,
  url: string
): Promise<Probe | URL> => {
  const { status } = response;
  const location = response.headers.get('location');
  if (status >= 200 && status < 300) return fromPage(response, url);
  await response.body?.cancel();
  if (status >= 300 && status < 400 && location !== null)
    return new URL(location, url);
  if (status === 401 || status === 403) {
    return gated(url, status, `asks for sign-in (HTTP ${String(status)})`);
  }
  return down(url, status, `HTTP ${String(status)}`);
};

/** Follows redirects by hand, so a hop to a login page can be recognized. */
export const probe = async (
  url: string,
  fetcher: Fetcher = fetch,
  timeoutMs = PROBE_TIMEOUT_MS
): Promise<Probe> => {
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    if (hop > 0 && isLoginUrl(current))
      return gated(current, null, 'redirects to sign-in');
    let response: Response;
    try {
      response = await fetcher(current, {
        redirect: 'manual',
        headers: { 'user-agent': USER_AGENT, accept: 'text/html,*/*;q=0.8' },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      return down(current, null, errorDetail(error));
    }
    const verdict = await classify(response, current);
    if (!(verdict instanceof URL)) return verdict;
    current = verdict.toString();
  }
  return down(current, null, 'too many redirects');
};

/** Runs `task` over `items` with at most `limit` in flight, keeping order. */
export const mapLimit = async <T, R>(
  items: readonly T[],
  limit: number,
  task: (item: T) => Promise<R>
): Promise<R[]> => {
  const results: R[] = new Array<R>(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await task(items[index] as T);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker)
  );
  return results;
};
