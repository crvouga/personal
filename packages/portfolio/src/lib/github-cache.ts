/**
 * Committed snapshot of the last good GitHub proof payload.
 *
 * The site is static, so the only thing GitHub downtime can break is the build.
 * A successful build rewrites `src/data/github-insights.json`; a build that
 * cannot reach GitHub renders that file instead of failing. Commit the refreshed
 * file to move the offline fallback forward.
 *
 * Plain `node:fs` on purpose: this runs inside `astro build` under Node, and a
 * file in the repo is the only store guaranteed to be present in the Docker
 * build context (see packages/portfolio/Dockerfile).
 *
 * Days are stored as a first-day date plus a flat count array rather than one
 * object per day: the file is rewritten on every build, so a compact, one-number
 * -per-line diff keeps the history readable. Shades and per-period statistics
 * are re-derived on read by the same `summarizeRange` the live fetch uses, so a
 * cached render and a live render can never disagree.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { summarizeRange } from './github-calendar';
import type { GitHubInsights, RawContributionDay } from './github-types';

/** Relative to the package root, which is `astro build`'s cwd. */
export const SNAPSHOT_RELATIVE_PATH = 'src/data/github-insights.json';

/** Bumped whenever the on-disk shape changes; older files are ignored. */
const SNAPSHOT_VERSION = 1;

const DAY_MS = 86_400_000;

type StoredRange = {
  readonly id: string;
  readonly label: string;
  readonly from: string;
  readonly to: string;
  readonly totalContributions: number;
  readonly privateContributions?: number;
  /** Day one of the grid; not always equal to `from` once GitHub clips. */
  readonly firstDay: string;
  /** Contribution counts, oldest → newest, one per day. */
  readonly counts: readonly number[];
};

type StoredSnapshot = {
  readonly version: number;
  readonly fetchedAt: string;
  readonly login: string;
  readonly totalContributions: number;
  readonly longestStreak: number;
  readonly currentStreak: number;
  readonly publicRepos: number;
  readonly followers: number;
  readonly ranges: readonly StoredRange[];
};

export const snapshotPath = (): string =>
  resolve(process.cwd(), SNAPSHOT_RELATIVE_PATH);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const isNumberArray = (value: unknown): boolean =>
  Array.isArray(value) &&
  value.length > 0 &&
  value.every((entry) => typeof entry === 'number');

const hasAll = (
  record: Record<string, unknown>,
  type: 'string' | 'number',
  keys: readonly string[]
): boolean => keys.every((key) => typeof record[key] === type);

const isStoredRange = (value: unknown): value is StoredRange =>
  isRecord(value) &&
  hasAll(value, 'string', ['id', 'label', 'from', 'to', 'firstDay']) &&
  hasAll(value, 'number', ['totalContributions']) &&
  isNumberArray(value['counts']);

const STORED_NUMBER_KEYS = [
  'totalContributions',
  'longestStreak',
  'currentStreak',
  'publicRepos',
  'followers',
] as const;

/**
 * Structural check, not a formality: a half-written or hand-edited snapshot must
 * be rejected so the build fails loudly instead of rendering a broken grid.
 */
export const isStoredSnapshot = (value: unknown): value is StoredSnapshot => {
  if (!isRecord(value)) return false;
  if (value['version'] !== SNAPSHOT_VERSION) return false;
  if (!hasAll(value, 'string', ['fetchedAt', 'login'])) return false;
  if (!hasAll(value, 'number', STORED_NUMBER_KEYS)) return false;
  const ranges = value['ranges'];
  return (
    Array.isArray(ranges) &&
    ranges.length > 0 &&
    ranges.every((entry: unknown) => isStoredRange(entry))
  );
};

const toStoredRange = (
  range: GitHubInsights['ranges'][number]
): StoredRange => ({
  id: range.id,
  label: range.label,
  from: range.from,
  to: range.to,
  totalContributions: range.totalContributions,
  ...(range.privateContributions === undefined
    ? {}
    : { privateContributions: range.privateContributions }),
  firstDay: range.calendar[0]?.date ?? range.from,
  counts: range.calendar.map((day) => day.count),
});

export const toStoredSnapshot = (insights: GitHubInsights): StoredSnapshot => ({
  version: SNAPSHOT_VERSION,
  fetchedAt: insights.fetchedAt,
  login: insights.login,
  totalContributions: insights.totalContributions,
  longestStreak: insights.longestStreak,
  currentStreak: insights.currentStreak,
  publicRepos: insights.publicRepos,
  followers: insights.followers,
  ranges: insights.ranges.map(toStoredRange),
});

const expandDays = (stored: StoredRange): readonly RawContributionDay[] => {
  const start = new Date(`${stored.firstDay}T00:00:00Z`).getTime();
  return stored.counts.map((count, index) => ({
    date: new Date(start + index * DAY_MS).toISOString().slice(0, 10),
    count,
  }));
};

export const fromStoredSnapshot = (stored: StoredSnapshot): GitHubInsights => ({
  fetchedAt: stored.fetchedAt,
  source: 'cache',
  login: stored.login,
  totalContributions: stored.totalContributions,
  longestStreak: stored.longestStreak,
  currentStreak: stored.currentStreak,
  publicRepos: stored.publicRepos,
  followers: stored.followers,
  ranges: stored.ranges.map((range) =>
    summarizeRange(range, expandDays(range))
  ),
});

/** Returns null when the snapshot is absent or unusable; never throws. */
export const readSnapshot = (path = snapshotPath()): GitHubInsights | null => {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
    if (!isStoredSnapshot(parsed)) return null;
    return fromStoredSnapshot(parsed);
  } catch {
    return null;
  }
};

/**
 * Best-effort: a read-only filesystem must not fail an otherwise good build.
 * Returns whether the snapshot was written.
 */
export const writeSnapshot = (
  insights: GitHubInsights,
  path = snapshotPath()
): boolean => {
  try {
    mkdirSync(dirname(path), { recursive: true });
    const body = JSON.stringify(toStoredSnapshot(insights), null, 2);
    writeFileSync(path, `${body}\n`, 'utf8');
    return true;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.warn(`[portfolio] could not refresh GitHub snapshot: ${detail}`);
    return false;
  }
};
