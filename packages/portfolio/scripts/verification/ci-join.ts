/**
 * "Failed CI before merge": the pure join between merged PRs and workflow run
 * attempts. Fetching lives in workflow-runs.ts; this module only decides.
 *
 * A PR counts when any `pull_request`-event run attempt
 *   - concluded `failure` (not `cancelled`, `skipped`, `startup_failure`…),
 *   - finished before the PR's `merged_at`, and
 *   - belongs to the PR: GitHub lists the PR in the run's `pull_requests[]`,
 *     or the run's `head_sha` is one of the PR's commits.
 * The head-SHA join is what catches runs GitHub did not associate (e.g. after
 * a force-push removed the branch tip it was linked through).
 */

import { hasAiTrailer, isAutomatedPr, type PrAuthorship } from './classify';

export type PrCommit = {
  readonly oid: string;
  readonly message: string;
};

export type MergedPr = PrAuthorship & {
  readonly number: number;
  readonly createdAt: string;
  readonly mergedAt: string;
  readonly commits: readonly PrCommit[];
};

export type RunAttempt = {
  readonly runId: number;
  readonly attempt: number;
  readonly conclusion: string | null;
  /** `updated_at` of the attempt: when it last changed, i.e. completed. */
  readonly completedAt: string;
  readonly headSha: string;
  readonly prNumbers: readonly number[];
};

export const shaIndex = (prs: readonly MergedPr[]): Map<string, number[]> => {
  const index = new Map<string, number[]>();
  for (const pr of prs) {
    for (const commit of pr.commits) {
      index.set(commit.oid, [...(index.get(commit.oid) ?? []), pr.number]);
    }
  }
  return index;
};

/** PR numbers an attempt belongs to, by association or by commit SHA. */
export const prsForAttempt = (
  attempt: RunAttempt,
  index: ReadonlyMap<string, readonly number[]>
): ReadonlySet<number> =>
  new Set([...attempt.prNumbers, ...(index.get(attempt.headSha) ?? [])]);

/** Sorted numbers of the PRs in `prs` with a failed attempt before merging. */
export const prsFailedBeforeMerge = (
  prs: readonly MergedPr[],
  attempts: readonly RunAttempt[]
): readonly number[] => {
  const byNumber = new Map(prs.map((pr) => [pr.number, pr]));
  const index = shaIndex(prs);
  const failed = new Set<number>();
  for (const attempt of attempts.filter(
    (entry) => entry.conclusion === 'failure'
  )) {
    for (const number of prsForAttempt(attempt, index)) {
      const pr = byNumber.get(number);
      if (
        pr !== undefined &&
        Date.parse(attempt.completedAt) < Date.parse(pr.mergedAt)
      ) {
        failed.add(number);
      }
    }
  }
  return [...failed].sort((a, b) => a - b);
};

export type PrPartition = {
  readonly human: readonly MergedPr[];
  readonly automated: readonly MergedPr[];
};

/** Splits PRs merged within `[fromMs, toMs]` into human and automated. */
export const partitionPrs = (
  prs: readonly MergedPr[],
  fromMs: number,
  toMs: number
): PrPartition => {
  const inWindow = prs.filter((pr) => {
    const merged = Date.parse(pr.mergedAt);
    return merged >= fromMs && merged <= toMs;
  });
  return {
    human: inWindow.filter((pr) => !isAutomatedPr(pr)),
    automated: inWindow.filter((pr) => isAutomatedPr(pr)),
  };
};

/** Sorted numbers of PRs with at least one AI `Co-Authored-By:` commit. */
export const aiCoAuthoredPrNumbers = (
  prs: readonly MergedPr[]
): readonly number[] =>
  prs
    .filter((pr) => pr.commits.some((commit) => hasAiTrailer(commit.message)))
    .map((pr) => pr.number)
    .sort((a, b) => a - b);
