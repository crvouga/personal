/** Shared shapes for the build-time GitHub proof data. */

/** A day as GitHub reports it, before a shade is assigned (see github-levels). */
export type RawContributionDay = {
  /** YYYY-MM-DD */
  readonly date: string;
  readonly count: number;
};

export type ContributionDay = {
  /** YYYY-MM-DD */
  readonly date: string;
  readonly count: number;
  readonly level: 0 | 1 | 2 | 3 | 4;
};

/** One selectable period in the proof section's date picker. */
export type ContributionRange = {
  readonly id: string;
  readonly label: string;
  readonly from: string;
  readonly to: string;
  readonly totalContributions: number;
  /** Contributions to private repositories; see github-calendar `RangeMeta`. */
  readonly privateContributions?: number;
  readonly longestStreak: number;
  /** Days with at least one contribution inside this period. */
  readonly activeDays: number;
  readonly busiestCount: number;
  /** Oldest → newest. */
  readonly calendar: readonly ContributionDay[];
};

/** Whether the rendered numbers came from GitHub or the committed snapshot. */
export type InsightsSource = 'live' | 'cache';

export type GitHubInsights = {
  /** ISO timestamp of the fetch that produced this payload. */
  readonly fetchedAt: string;
  readonly source: InsightsSource;
  readonly login: string;
  /** Trailing-12-month totals; the headline numbers. */
  readonly totalContributions: number;
  readonly longestStreak: number;
  readonly currentStreak: number;
  readonly publicRepos: number;
  readonly followers: number;
  /** Trailing 12 months first, then calendar years newest → oldest. */
  readonly ranges: readonly ContributionRange[];
};

export type GitHubFetchOptions = {
  readonly token?: string;
  readonly fetchFn?: typeof fetch;
  readonly now?: Date;
  /** Attempts per request, including the first. Defaults to 3. */
  readonly attempts?: number;
  /** Overrides the between-attempt sleep; tests pass a no-op. */
  readonly sleepFn?: (ms: number) => Promise<void>;
  /** Clock used to interpret rate-limit reset headers; tests pin it. */
  readonly nowFn?: () => number;
};
