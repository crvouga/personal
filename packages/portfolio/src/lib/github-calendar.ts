/**
 * GraphQL contribution-calendar fetch for every selectable period at once.
 *
 * `contributionsCollection` caps a window at one year, so each period is its own
 * aliased field (`r0`, `r1`, …) inside a single document — one request, one rate
 * limit hit, regardless of how many periods the picker offers.
 */

import {
  GitHubInsightsError,
  REMEDIATION,
  SCOPE_REMEDIATION,
} from './github-error';
import { requestJson, type RequestConfig } from './github-http';
import { withLevels } from './github-levels';
import { windowBounds, type RangeWindow } from './github-ranges';
import type { ContributionRange, RawContributionDay } from './github-types';

const GRAPHQL_URL = 'https://api.github.com/graphql';
const CONTEXT = 'GitHub GraphQL contribution calendar';

/**
 * A full trailing year. GitHub clips the window at the requested bounds, so the
 * count lands near 365; the floor only has to catch a grossly truncated payload.
 */
const MIN_TRAILING_DAYS = 360;

const CALENDAR_FIELDS =
  'restrictedContributionsCount contributionCalendar{totalContributions weeks{contributionDays{date contributionCount}}}';

const toRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : null;

export const buildCalendarQuery = (windows: readonly RangeWindow[]): string => {
  const params = windows
    .map((_, i) => `$f${String(i)}:DateTime!,$t${String(i)}:DateTime!`)
    .join(',');
  const fields = windows
    .map(
      (_, i) =>
        `r${String(i)}:contributionsCollection(from:$f${String(i)},to:$t${String(i)}){${CALENDAR_FIELDS}}`
    )
    .join(' ');
  return `query($login:String!,${params}){user(login:$login){${fields}}}`;
};

const buildVariables = (
  login: string,
  windows: readonly RangeWindow[]
): Record<string, string> => {
  const variables: Record<string, string> = { login };
  windows.forEach((window, i) => {
    const bounds = windowBounds(window);
    variables[`f${String(i)}`] = bounds.from;
    variables[`t${String(i)}`] = bounds.to;
  });
  return variables;
};

const toDay = (value: unknown): RawContributionDay => {
  const day = toRecord(value);
  const rawCount = day?.['contributionCount'];
  const rawDate = day?.['date'];
  return {
    date: typeof rawDate === 'string' ? rawDate : '',
    count: typeof rawCount === 'number' ? rawCount : 0,
  };
};

const flattenWeeks = (weeks: readonly unknown[]): RawContributionDay[] =>
  weeks.flatMap((week) => {
    const days = toRecord(week)?.['contributionDays'];
    return Array.isArray(days) ? days.map(toDay) : [];
  });

export const longestStreakOf = (
  calendar: readonly RawContributionDay[]
): number => {
  let longest = 0;
  let run = 0;
  for (const day of calendar) {
    run = day.count > 0 ? run + 1 : 0;
    if (run > longest) longest = run;
  }
  return longest;
};

/**
 * Counts back from the newest day. Today without contributions yet does not
 * break the streak; any earlier empty day does.
 */
export const currentStreakOf = (
  calendar: readonly RawContributionDay[]
): number => {
  let streak = 0;
  for (let i = calendar.length - 1; i >= 0; i -= 1) {
    const day = calendar[i];
    if (day === undefined) break;
    if (day.count > 0) {
      streak += 1;
      continue;
    }
    if (i === calendar.length - 1) continue;
    break;
  }
  return streak;
};

/** Period identity plus GitHub's own total; the rest is derived from the days. */
export type RangeMeta = {
  readonly id: string;
  readonly label: string;
  readonly from: string;
  readonly to: string;
  readonly totalContributions: number;
  /**
   * Contributions to private repositories, which GitHub counts in the total
   * but does not show. Absent from snapshots written before it was fetched.
   */
  readonly privateContributions?: number;
};

/**
 * Derives every secondary statistic from the day list so a rehydrated snapshot
 * and a live fetch cannot disagree (see lib/github-cache.ts).
 */
export const summarizeRange = (
  meta: RangeMeta,
  days: readonly RawContributionDay[]
): ContributionRange => ({
  ...meta,
  longestStreak: longestStreakOf(days),
  activeDays: days.filter((day) => day.count > 0).length,
  busiestCount: days.reduce((max, day) => Math.max(max, day.count), 0),
  calendar: withLevels(days),
});

const toRange = (
  window: RangeWindow,
  calendar: readonly RawContributionDay[],
  totals: { readonly total: number; readonly restricted: unknown }
): ContributionRange =>
  summarizeRange(
    {
      id: window.id,
      label: window.label,
      from: window.from,
      to: window.to,
      totalContributions: totals.total,
      ...(typeof totals.restricted === 'number'
        ? { privateContributions: totals.restricted }
        : {}),
    },
    calendar
  );

/**
 * A profile with activity set to private yields an empty or all-zero trailing
 * calendar; that is a credential-scope failure, never valid empty activity.
 * Calendar-year windows are allowed to be empty and are dropped by the caller.
 */
const assertUsableTrailing = (
  calendar: readonly RawContributionDay[],
  login: string
): void => {
  if (calendar.length === 0 || calendar.every((day) => day.count === 0)) {
    throw new GitHubInsightsError(
      'empty-calendar',
      `GitHub returned no visible contributions for ${login}. ${SCOPE_REMEDIATION}`
    );
  }
  if (calendar.length < MIN_TRAILING_DAYS) {
    throw new GitHubInsightsError(
      'invalid-response',
      `${CONTEXT} returned ${String(calendar.length)} days, expected at least ${String(MIN_TRAILING_DAYS)}. ${REMEDIATION}`
    );
  }
};

/**
 * GraphQL reports its own outages with HTTP 200 and an `errors[]` array, so the
 * status code cannot classify them. These are the transient ones: a secondary
 * rate limit, and the backend timeout GitHub phrases as "something went wrong".
 * Everything else — `NOT_FOUND`, `FORBIDDEN`, `INSUFFICIENT_SCOPES` — is a
 * credential or query problem that will fail identically on every attempt.
 */
const TRANSIENT_ERROR_TYPES = new Set(['RATE_LIMITED', 'SERVICE_UNAVAILABLE']);
const TRANSIENT_MESSAGE = /something went wrong|timeout|timed out|try again/i;

const isTransientGraphQLError = (error: unknown): boolean => {
  const record = toRecord(error);
  const type = record?.['type'];
  if (typeof type === 'string' && TRANSIENT_ERROR_TYPES.has(type)) return true;
  const message = record?.['message'];
  return typeof message === 'string' && TRANSIENT_MESSAGE.test(message);
};

/**
 * Throws on a GraphQL-level failure. Runs inside the HTTP retry loop (passed as
 * `validate`), which is the only place a retryable 200 can be retried.
 */
const assertNoGraphQLErrors = (json: unknown): void => {
  const errors = toRecord(json)?.['errors'];
  if (!Array.isArray(errors) || errors.length === 0) return;
  const detail = errors
    .map((e) => toRecord(e)?.['message'] ?? 'unknown error')
    .join('; ');
  const retryable = errors.some(isTransientGraphQLError);
  const suffix = retryable ? '[transient]' : SCOPE_REMEDIATION;
  throw new GitHubInsightsError(
    'api-error',
    `${CONTEXT} returned errors: ${detail}. ${suffix}`,
    { retryable }
  );
};

const readUser = (json: unknown): Record<string, unknown> => {
  const user = toRecord(toRecord(toRecord(json)?.['data'])?.['user']);
  if (user === null) {
    throw new GitHubInsightsError(
      'invalid-response',
      `${CONTEXT} returned no user payload. ${REMEDIATION}`
    );
  }
  return user;
};

const readRange = (
  user: Record<string, unknown>,
  window: RangeWindow,
  index: number
): ContributionRange => {
  const collection = toRecord(user[`r${String(index)}`]);
  const calendarJson = toRecord(collection?.['contributionCalendar']);
  const weeks = calendarJson?.['weeks'];
  const total = calendarJson?.['totalContributions'];
  if (!Array.isArray(weeks) || typeof total !== 'number') {
    throw new GitHubInsightsError(
      'invalid-response',
      `${CONTEXT} returned no calendar for period ${window.id}. ${REMEDIATION}`
    );
  }
  return toRange(window, flattenWeeks(weeks), {
    total,
    restricted: collection?.['restrictedContributionsCount'],
  });
};

export const fetchRanges = async (
  config: RequestConfig,
  login: string,
  token: string,
  windows: readonly RangeWindow[]
): Promise<readonly ContributionRange[]> => {
  const json = await requestJson(config, {
    url: GRAPHQL_URL,
    init: {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'User-Agent': 'portfolio-build',
      },
      body: JSON.stringify({
        query: buildCalendarQuery(windows),
        variables: buildVariables(login, windows),
      }),
    },
    context: CONTEXT,
    validate: assertNoGraphQLErrors,
  });
  const user = readUser(json);
  const ranges = windows.map((window, i) => readRange(user, window, i));
  const trailing = ranges[0];
  if (trailing === undefined) {
    throw new GitHubInsightsError(
      'invalid-response',
      `${CONTEXT} returned no periods. ${REMEDIATION}`
    );
  }
  assertUsableTrailing(trailing.calendar, login);
  // Years the account predates come back empty; drop them instead of rendering
  // a blank grid behind a selectable label.
  return [trailing, ...ranges.slice(1).filter((r) => r.totalContributions > 0)];
};
