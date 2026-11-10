/**
 * Every number the page uses as evidence, derived from the committed snapshots
 * (`src/data/platform-facts.json`, `src/data/verification.json`) so no figure
 * is typed into prose or a component. The hero chips, the proof tiles, the
 * case studies and the résumé all read from here.
 */
import type { ContributionRange } from './github-types';
import { loadPlatformFacts, trailersFor } from './platform-facts';
import { loadVerification } from './verification';

import type { Theme } from '../knowledge/themes';
export const PLATFORM_FACTS = loadPlatformFacts();
export const VERIFICATION = loadVerification();

const SNAPSHOT = VERIFICATION.snapshot;

export const count = (value: number): string => value.toLocaleString('en-US');

export const percent = (part: number, whole: number): string =>
  whole === 0 ? '0%' : `${String(Math.round((part / whole) * 100))}%`;

/** Tests across the three public repositories the page links as samples. */
export const PUBLIC_TEST_CALL_SITES =
  PLATFORM_FACTS.workspaceTestCallSites +
  SNAPSHOT.mockingbird.testCallSites +
  SNAPSHOT.headlessCombobox.testCallSites;

export type ProofTile = {
  readonly value: string;
  readonly label: string;
  readonly detail: string;
  /** What it is evidence of; each role leads with the tiles it values. */
  readonly themes: readonly Theme[];
};

const ws = SNAPSHOT.workspace;

/**
 * In the order the section argues by default: the pipeline caught things, it
 * is strict, it is backed by tests, and agents write inside it. Each role
 * re-ranks them by what its readers value (`Presentation.proofTiles`).
 */
export const PROOF_TILES: readonly ProofTile[] = [
  {
    value: count(ws.prsFailedCiBeforeMerge),
    label: 'pull requests failed CI, were fixed, then merged',
    detail: `${percent(ws.prsFailedCiBeforeMerge, ws.mergedPrs)} of ${count(ws.mergedPrs)} merged; none merged until every required check passed`,
    themes: ['testing-quality', 'ci-cd'],
  },
  {
    value: count(PLATFORM_FACTS.checkGateJobInstances),
    label: 'CI jobs gate every merge',
    detail: `behind ${count(PLATFORM_FACTS.requiredChecks.length)} required checks: ${PLATFORM_FACTS.requiredChecks.join(', ')}`,
    themes: ['ci-cd', 'process'],
  },
  {
    value: count(PUBLIC_TEST_CALL_SITES),
    label: 'tests in three public repositories',
    detail: 'workspace, Mockingbird and headless-combobox',
    themes: ['testing-quality', 'open-source'],
  },
  {
    value: count(ws.aiCoAuthoredPrs),
    label: 'pull requests co-written with AI coding agents',
    detail: `of the ${count(ws.mergedPrs)}, through the same gates`,
    themes: ['ai-assisted'],
  },
];

const ISO_DATE = 10;

export const VERIFICATION_WINDOW = {
  from: SNAPSHOT.window.from.slice(0, ISO_DATE),
  to: SNAPSHOT.window.to.slice(0, ISO_DATE),
};

const DAY_MS = 86_400_000;
const WINDOW_DAYS = 90;

/**
 * Why the window starts where it does: the last ninety days, or, when the
 * repository has been merging pull requests for less time than that, its
 * first merged pull request.
 */
export const VERIFICATION_WINDOW_NOTE =
  Date.parse(SNAPSHOT.window.to) - Date.parse(SNAPSHOT.window.from) <
  WINDOW_DAYS * DAY_MS
    ? 'from its first merged pull request'
    : 'over the last ninety days';

/** The exclusion is stated, never silent. */
export const PROOF_EXCLUSIONS = `${count(ws.automatedPrsExcluded)} automated snapshot pull requests excluded`;

export const VERIFICATION_REPO_URL = `https://github.com/${ws.repo}`;

export const AI_TRAILERS = {
  claudeCode: trailersFor(PLATFORM_FACTS, 'Claude Code'),
  cursor: trailersFor(PLATFORM_FACTS, 'Cursor'),
};

/** A day this far above the period's median active day gets a footnote. */
export const ANOMALY_FACTOR = 10;

const median = (values: readonly number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 0) return 0;
  const mid = Math.floor(sorted.length / 2);
  const upper = sorted[mid] ?? 0;
  if (sorted.length % 2 === 1) return upper;
  return ((sorted[mid - 1] ?? 0) + upper) / 2;
};

export type Anomaly = {
  readonly date: string;
  readonly count: number;
  readonly medianActiveDay: number;
};

/** The busiest day, when it is an outlier worth explaining. */
export const anomalyOf = (range: ContributionRange): Anomaly | null => {
  const active = range.calendar.filter((day) => day.count > 0);
  const typical = median(active.map((day) => day.count));
  const peak = active.reduce<(typeof active)[number] | undefined>(
    (best, day) => (best === undefined || day.count > best.count ? day : best),
    undefined
  );
  if (peak === undefined || typical === 0) return null;
  if (peak.count < typical * ANOMALY_FACTOR) return null;
  return { date: peak.date, count: peak.count, medianActiveDay: typical };
};
