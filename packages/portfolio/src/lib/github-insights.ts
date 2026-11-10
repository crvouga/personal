/**
 * Uptime policy for the proof section.
 *
 * Order of preference:
 *   1. live GitHub data (retried on transient failures), which also refreshes
 *      the committed snapshot;
 *   2. the committed snapshot, rendered with a visible "cached" caption that
 *      states how old it is;
 *   3. nothing — a notice card in `astro dev`, a hard build failure otherwise.
 *
 * Step 2 is why a GitHub incident, an expired token, or a rate-limit window
 * cannot take the site's build down. It is deliberately *not* why the data is
 * fresh: freshness comes from the scheduled rebuild in ci.yml, and a snapshot
 * old enough to mean that schedule has stopped working is logged loudly here so
 * the failure surfaces in CI instead of only on the page.
 */

import { fetchGitHubInsights } from './github';
import { readSnapshot, writeSnapshot } from './github-cache';
import { GitHubInsightsError, errorMessage } from './github-error';
import { freshnessOf, isStale, type Freshness } from './github-freshness';
import type { GitHubFetchOptions, GitHubInsights } from './github-types';

export type LoadOptions = GitHubFetchOptions & {
  /** `astro dev` renders a notice instead of failing the build. */
  readonly allowMissing?: boolean;
  /** Skips the snapshot write; set for dev servers and tests. */
  readonly persist?: boolean;
  readonly snapshotPath?: string;
  /** Read the committed snapshot only, never GitHub: Storybook's stories
   *  must render the same everywhere, offline, without moving the snapshot. */
  readonly snapshotOnly?: boolean;
};

export type LoadResult = {
  readonly insights: GitHubInsights | null;
  /** Human-readable reason the live fetch was not used, if it was not. */
  readonly warning: string | null;
  /** Age of the data being rendered; null when there is none. */
  readonly freshness: Freshness | null;
};

const logMiss = (reason: string): null => {
  console.warn(`[portfolio] no GitHub snapshot available (${reason})`);
  return null;
};

/**
 * A stale snapshot is not a rendering problem — the page is fine — but it does
 * mean the daily refresh is not landing, so it is worth shouting about in a
 * build log somebody reads.
 */
const reportStaleness = (freshness: Freshness): void => {
  if (!isStale(freshness)) return;
  console.warn(
    `[portfolio] GitHub snapshot is ${freshness.label}; the scheduled refresh ` +
      `(ci.yml) may have stopped running. The page renders, but the numbers are history.`
  );
};

const snapshotOnly = (options: LoadOptions, now: Date): LoadResult => {
  const cached = readSnapshot(options.snapshotPath);
  return {
    insights: cached,
    warning: cached === null ? 'no committed snapshot' : null,
    freshness: cached === null ? null : freshnessOf(cached.fetchedAt, now),
  };
};

export const loadGitHubInsights = async (
  login: string,
  options: LoadOptions = {}
): Promise<LoadResult> => {
  const now = options.now ?? new Date();
  if (options.snapshotOnly === true) return snapshotOnly(options, now);
  try {
    const insights = await fetchGitHubInsights(login, options);
    if (options.persist !== false) {
      writeSnapshot(insights, options.snapshotPath);
    }
    return {
      insights,
      warning: null,
      freshness: freshnessOf(insights.fetchedAt, now),
    };
  } catch (error) {
    if (!(error instanceof GitHubInsightsError)) throw error;
    const reason = errorMessage(error);
    console.warn(`[portfolio] GitHub proof fetch failed: ${reason}`);
    const cached = readSnapshot(options.snapshotPath);
    if (cached !== null) {
      const freshness = freshnessOf(cached.fetchedAt, now);
      reportStaleness(freshness);
      return { insights: cached, warning: reason, freshness };
    }
    logMiss(reason);
    if (options.allowMissing === true) {
      return { insights: null, warning: reason, freshness: null };
    }
    throw error;
  }
};
