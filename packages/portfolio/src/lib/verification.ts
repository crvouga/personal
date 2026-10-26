/**
 * Verification snapshot: how often CI caught a problem before merge, and
 * the public state of the flagship repositories.
 *
 * `scripts/refresh-verification.ts` fetches it from the GitHub API and writes
 * `src/data/verification.json`; the Maintenance workflow refreshes it daily
 * through the same bot PR as the GitHub insights snapshot. The site build only
 * ever reads the committed file — it never calls GitHub for this data — and
 * reports its age with the thresholds from github-freshness.ts.
 *
 * Validation is structural and strict: a malformed file throws, failing the
 * build instead of rendering a wrong number.
 */

import raw from '../data/verification.json';
import { freshnessOf, type Freshness } from './github-freshness';

export const VERIFICATION_VERSION = 1;

export type RepoStats = {
  /** `owner/name`. */
  readonly repo: string;
  readonly url: string;
  readonly defaultBranch: string;
  /** Stargazers: the one adoption figure GitHub reports for a library. */
  readonly stars: number;
  /** Commits reachable from the default branch. */
  readonly commits: number;
  /** Open issues, excluding pull requests. */
  readonly openIssues: number;
  readonly openPrs: number;
  /** SPDX id from the API, or null when GitHub detects no license. */
  readonly license: string | null;
  /** Name of the workflow chosen as the repo's primary CI (see repo-stats.ts). */
  readonly defaultBranchCiWorkflow: string | null;
  /** `success`, `failure`, … of its latest completed default-branch run. */
  readonly defaultBranchCiConclusion: string | null;
  readonly defaultBranchCiRunUrl: string | null;
  readonly defaultBranchCiCompletedAt: string | null;
};

export type CloneStats = {
  /** Default-branch commit the clone was read at. */
  readonly commit: string;
  /** `*.test.ts`, `*.test.tsx` and `*.spec.ts` files. */
  readonly testFiles: number;
  /** `test(`/`it(` call sites (incl. modifiers) in those files. */
  readonly testCallSites: number;
};

export type MockingbirdStats = CloneStats & {
  /** Non-private `package.json` files. */
  readonly publishedPackages: number;
  /** Non-private packages directly under `packages/service/`. */
  readonly emulators: number;
  /** Emulators described as work-in-progress or scaffold. */
  readonly wipEmulators: number;
  /** `*.property.test.ts` files. */
  readonly propertyTestFiles: number;
};

export type WorkspacePrStats = {
  readonly repo: string;
  /** Human-authored PRs merged in the window. */
  readonly mergedPrs: number;
  /** Merged PRs from `[bot]` authors or scheduled-automation branches. */
  readonly automatedPrsExcluded: number;
  /** Head branches treated as scheduled automation. */
  readonly automationPatterns: readonly string[];
  /** Human PRs with a failed `pull_request` run attempt before merge. */
  readonly prsFailedCiBeforeMerge: number;
  readonly prsFailedCiBeforeMergeNumbers: readonly number[];
  /** Human PRs with a Claude or Cursor `Co-Authored-By:` commit. */
  readonly aiCoAuthoredPrs: number;
  readonly aiCoAuthoredPrNumbers: readonly number[];
  /** Latest-attempt `pull_request` runs listed for the join. */
  readonly pullRequestRunsExamined: number;
  /** Earlier attempts of re-run runs fetched for the join. */
  readonly earlierAttemptsExamined: number;
};

/** Mockingbird's published totals, from the docs site's `catalog.json`. */
export type CatalogStats = {
  readonly url: string;
  /** Emulators the docs site lists, as its headline counts them. */
  readonly services: number;
  /** Vendor operations the emulators support. */
  readonly opsSupported: number;
  /** Vendor operations in the vendored contracts. */
  readonly opsTotal: number;
};

export type VerificationSnapshot = {
  readonly version: typeof VERIFICATION_VERSION;
  readonly fetchedAt: string;
  /** Inclusive UTC dates: max(today − 90 days, first merged PR) → today. */
  readonly window: { readonly from: string; readonly to: string };
  readonly workspace: WorkspacePrStats;
  readonly repos: readonly RepoStats[];
  readonly mockingbird: MockingbirdStats;
  readonly mockingbirdCatalog: CatalogStats;
  readonly headlessCombobox: CloneStats;
};

export type LoadedVerification = {
  readonly snapshot: VerificationSnapshot;
  readonly freshness: Freshness;
};

type Kind = 'count' | 'text' | 'nullableText' | 'counts' | 'texts';
type Shape = Readonly<Record<string, Kind>>;

const fail = (detail: string): never => {
  throw new Error(
    `src/data/verification.json is malformed: ${detail}. ` +
      'Regenerate it with `bun run refresh-verification` from packages/portfolio.'
  );
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isCount = (value: unknown): boolean =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0;

const isText = (value: unknown): boolean =>
  typeof value === 'string' && value.length > 0;

const CHECKS: Readonly<Record<Kind, (value: unknown) => boolean>> = {
  count: isCount,
  text: isText,
  nullableText: (value) => value === null || isText(value),
  counts: (value) => Array.isArray(value) && value.every(isCount),
  texts: (value) => Array.isArray(value) && value.every(isText),
};

const checkShape = (
  value: unknown,
  shape: Shape,
  where: string
): Record<string, unknown> => {
  if (!isRecord(value)) return fail(`${where} must be an object`);
  for (const [key, kind] of Object.entries(shape)) {
    if (!CHECKS[kind](value[key])) fail(`${where}.${key} must be ${kind}`);
  }
  return value;
};

const CLONE: Shape = {
  commit: 'text',
  testFiles: 'count',
  testCallSites: 'count',
};

const SHAPES = {
  root: { fetchedAt: 'text' },
  window: { from: 'text', to: 'text' },
  workspace: {
    repo: 'text',
    mergedPrs: 'count',
    automatedPrsExcluded: 'count',
    automationPatterns: 'texts',
    prsFailedCiBeforeMerge: 'count',
    prsFailedCiBeforeMergeNumbers: 'counts',
    aiCoAuthoredPrs: 'count',
    aiCoAuthoredPrNumbers: 'counts',
    pullRequestRunsExamined: 'count',
    earlierAttemptsExamined: 'count',
  },
  repo: {
    repo: 'text',
    url: 'text',
    defaultBranch: 'text',
    stars: 'count',
    commits: 'count',
    openIssues: 'count',
    openPrs: 'count',
    license: 'nullableText',
    defaultBranchCiWorkflow: 'nullableText',
    defaultBranchCiConclusion: 'nullableText',
    defaultBranchCiRunUrl: 'nullableText',
    defaultBranchCiCompletedAt: 'nullableText',
  },
  mockingbird: {
    ...CLONE,
    publishedPackages: 'count',
    emulators: 'count',
    wipEmulators: 'count',
    propertyTestFiles: 'count',
  },
  catalog: {
    url: 'text',
    services: 'count',
    opsSupported: 'count',
    opsTotal: 'count',
  },
} as const satisfies Readonly<Record<string, Shape>>;

/** Totals must agree with the PR lists they summarise. */
const checkWorkspace = (value: unknown): void => {
  const workspace = checkShape(value, SHAPES.workspace, 'workspace');
  const failed = workspace[
    'prsFailedCiBeforeMergeNumbers'
  ] as readonly number[];
  const ai = workspace['aiCoAuthoredPrNumbers'] as readonly number[];
  const merged = workspace['mergedPrs'] as number;
  if (failed.length !== workspace['prsFailedCiBeforeMerge'])
    fail('failed-PR total disagrees with its list');
  if (ai.length !== workspace['aiCoAuthoredPrs'])
    fail('AI-PR total disagrees with its list');
  if (failed.length > merged || ai.length > merged)
    fail('a PR subset exceeds mergedPrs');
};

const checkRepos = (value: unknown): void => {
  if (!Array.isArray(value) || value.length === 0)
    fail('repos must be a non-empty list');
  (value as readonly unknown[]).forEach((repo, index) =>
    checkShape(repo, SHAPES.repo, `repos[${String(index)}]`)
  );
};

/** Throws on anything that is not a complete, current-version snapshot. */
export const parseVerificationSnapshot = (
  value: unknown
): VerificationSnapshot => {
  const root = checkShape(value, SHAPES.root, 'snapshot');
  if (root['version'] !== VERIFICATION_VERSION)
    fail(`version must be ${String(VERIFICATION_VERSION)}`);
  if (Number.isNaN(Date.parse(root['fetchedAt'] as string)))
    fail('fetchedAt must be a date');
  checkShape(root['window'], SHAPES.window, 'window');
  checkWorkspace(root['workspace']);
  checkRepos(root['repos']);
  checkShape(root['mockingbird'], SHAPES.mockingbird, 'mockingbird');
  checkShape(root['mockingbirdCatalog'], SHAPES.catalog, 'mockingbirdCatalog');
  checkShape(root['headlessCombobox'], CLONE, 'headlessCombobox');
  // Every field the type declares has been checked above.
  return root as unknown as VerificationSnapshot;
};

let cached: VerificationSnapshot | null = null;

/** The committed snapshot, validated once per process, with its age. */
export const loadVerification = (
  now: Date = new Date()
): LoadedVerification => {
  cached ??= parseVerificationSnapshot(raw);
  return { snapshot: cached, freshness: freshnessOf(cached.fetchedAt, now) };
};

/** Stats for one repository in the snapshot, by `owner/name`. */
export const repoStatsFor = (
  snapshot: VerificationSnapshot,
  repo: string
): RepoStats | undefined => snapshot.repos.find((entry) => entry.repo === repo);
