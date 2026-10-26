/**
 * Strict GitHub REST/GraphQL client for the verification refresh.
 *
 * Every request goes through `requestJson` from src/lib/github-http.ts, so it
 * inherits the same timeout, backoff, and `Retry-After` / rate-limit handling
 * as the build. Pagination needs the `Link` header, which `requestJson` does
 * not return; a per-request `fetchFn` wrapper captures the final response's
 * headers instead of forking the retry logic.
 */

import { GitHubInsightsError } from '../../src/lib/github-error';
import { requestJson } from '../../src/lib/github-http';
import { arrayAt, recordAt, toRecord } from './json-fields';

const API = 'https://api.github.com';
const TOKEN_KEYS = ['GITHUB_TOKEN', 'PORTFOLIO_GITHUB_TOKEN'] as const;
/** Bounded so a paging bug cannot loop forever. */
const MAX_PAGES = 200;

export type RestResponse = {
  readonly json: unknown;
  readonly headers: Headers;
};

export type GitHubClient = {
  readonly rest: (path: string, accept?: string) => Promise<RestResponse>;
  readonly graphql: (
    query: string,
    variables: Readonly<Record<string, unknown>>
  ) => Promise<Record<string, unknown>>;
};

export const resolveToken = (env = process.env): string => {
  const token = TOKEN_KEYS.map((key) => env[key]?.trim() ?? '').find(
    (value) => value !== ''
  );
  if (token === undefined) {
    throw new GitHubInsightsError(
      'missing-token',
      `Set GITHUB_TOKEN or PORTFOLIO_GITHUB_TOKEN (e.g. GITHUB_TOKEN=$(gh auth token)).`
    );
  }
  return token;
};

const TRANSIENT_GRAPHQL =
  /RATE_LIMITED|SERVICE_UNAVAILABLE|something went wrong|timeout|timed out/i;

/** Runs inside the retry loop: GraphQL reports outages as HTTP 200. */
const assertNoGraphQLErrors = (json: unknown): void => {
  const errors = toRecord(json)?.['errors'];
  if (!Array.isArray(errors) || errors.length === 0) return;
  const detail = JSON.stringify(errors).slice(0, 500);
  throw new GitHubInsightsError(
    'api-error',
    `GitHub GraphQL returned errors: ${detail}`,
    {
      retryable: TRANSIENT_GRAPHQL.test(detail),
    }
  );
};

const headersFor = (token: string, accept: string): Record<string, string> => ({
  Authorization: `Bearer ${token}`,
  'User-Agent': 'portfolio-verification-refresh',
  Accept: accept,
  'X-GitHub-Api-Version': '2022-11-28',
});

export const createClient = (
  token: string,
  fetchFn: typeof fetch = globalThis.fetch
): GitHubClient => {
  const rest = async (
    path: string,
    accept = 'application/vnd.github+json'
  ): Promise<RestResponse> => {
    let headers = new Headers();
    const capture = Object.assign(
      async (...args: Parameters<typeof fetch>): Promise<Response> => {
        const response = await fetchFn(...args);
        headers = response.headers;
        return response;
      },
      { preconnect: fetchFn.preconnect }
    );
    const url = path.startsWith('https://') ? path : `${API}${path}`;
    const json = await requestJson(
      { fetchFn: capture, attempts: 4 },
      {
        url,
        init: { headers: headersFor(token, accept) },
        context: `GET ${url}`,
      }
    );
    return { json, headers };
  };
  const graphql = async (
    query: string,
    variables: Readonly<Record<string, unknown>>
  ): Promise<Record<string, unknown>> => {
    const json = await requestJson(
      { fetchFn, attempts: 4 },
      {
        url: `${API}/graphql`,
        init: {
          method: 'POST',
          headers: headersFor(token, 'application/json'),
          body: JSON.stringify({ query, variables }),
        },
        context: 'POST /graphql',
        validate: assertNoGraphQLErrors,
      }
    );
    return recordAt(json, 'data', 'POST /graphql');
  };
  return { rest, graphql };
};

/** The `rel="next"` / `rel="last"` target of a `Link` header, if any. */
export const linkTarget = (
  headers: Headers,
  rel: 'next' | 'last'
): string | null => {
  const link = headers.get('link') ?? '';
  const match = link
    .split(',')
    .map((part) => /<([^>]+)>\s*;\s*rel="([^"]+)"/.exec(part.trim()))
    .find((entry) => entry?.[2] === rel);
  return match?.[1] ?? null;
};

/**
 * Follows `Link: rel="next"` and concatenates `pick(page)`. `pick` receives
 * each page body; list endpoints return arrays, run listings wrap them.
 */
export const paginate = async (
  client: GitHubClient,
  path: string,
  pick: (json: unknown) => readonly unknown[] = (json) =>
    arrayAt({ items: json }, 'items', path)
): Promise<readonly unknown[]> => {
  const items: unknown[] = [];
  let next: string | null = path;
  for (let page = 0; next !== null && page < MAX_PAGES; page += 1) {
    const response = await client.rest(next);
    items.push(...pick(response.json));
    next = linkTarget(response.headers, 'next');
  }
  if (next !== null)
    throw new Error(`${path}: more than ${String(MAX_PAGES)} pages`);
  return items;
};

/**
 * Size of a list with `per_page=1`: the `page=` of the `rel="last"` link, or
 * the length of the only page when there is no link.
 */
export const countViaLastPage = async (
  client: GitHubClient,
  path: string
): Promise<number> => {
  const response = await client.rest(path);
  const last = linkTarget(response.headers, 'last');
  if (last === null)
    return arrayAt({ items: response.json }, 'items', path).length;
  const page = Number(new URL(last).searchParams.get('page'));
  if (!Number.isInteger(page) || page < 1)
    throw new Error(`${path}: unusable last link ${last}`);
  return page;
};
