/**
 * `pull_request`-event workflow runs, listed once and joined locally.
 *
 * The runs endpoint returns at most 1,000 results for a filtered query, so a
 * date range whose `total_count` exceeds that is split in half until each
 * slice fits. The listing shows each run's *latest* attempt only; a run that
 * was re-run (`run_attempt > 1`) has its earlier attempts fetched as well —
 * a red first attempt followed by a green re-run is still CI catching
 * something — but only for runs that belong to a PR being counted.
 */

import {
  prsForAttempt,
  shaIndex,
  type MergedPr,
  type RunAttempt,
} from './ci-join';
import { paginate, type GitHubClient } from './github-client';
import { arrayAt, nullableStringAt, numberAt, stringAt } from './json-fields';

const SEARCH_CAP = 1000;
const DAY_MS = 86_400_000;

const day = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

const listPath = (
  repo: string,
  fromMs: number,
  toMs: number,
  perPage: number
): string =>
  `/repos/${repo}/actions/runs?event=pull_request&per_page=${String(perPage)}` +
  `&created=${day(fromMs)}..${day(toMs)}`;

const toAttempt = (run: unknown, where: string): RunAttempt => ({
  runId: numberAt(run, 'id', where),
  attempt: numberAt(run, 'run_attempt', where),
  conclusion: nullableStringAt(run, 'conclusion', where),
  completedAt: stringAt(run, 'updated_at', where),
  headSha: stringAt(run, 'head_sha', where),
  prNumbers: arrayAt(run, 'pull_requests', where).map((pr) =>
    numberAt(pr, 'number', where)
  ),
});

const listSlice = async (
  client: GitHubClient,
  repo: string,
  fromMs: number,
  toMs: number
): Promise<readonly RunAttempt[]> => {
  const probe = await client.rest(listPath(repo, fromMs, toMs, 1));
  const total = numberAt(probe.json, 'total_count', 'actions/runs');
  if (total > SEARCH_CAP && toMs - fromMs >= DAY_MS) {
    const mid = fromMs + Math.floor((toMs - fromMs) / DAY_MS / 2) * DAY_MS;
    return [
      ...(await listSlice(client, repo, fromMs, mid)),
      ...(await listSlice(client, repo, mid + DAY_MS, toMs)),
    ];
  }
  if (total > SEARCH_CAP)
    throw new Error(`${repo}: >${String(SEARCH_CAP)} runs on ${day(fromMs)}`);
  const path = listPath(repo, fromMs, toMs, 100);
  const runs = await paginate(client, path, (json) =>
    arrayAt(json, 'workflow_runs', path)
  );
  return runs.map((run) => toAttempt(run, path));
};

/** Latest attempts of every `pull_request` run created in the date range. */
export const listPullRequestRuns = async (
  client: GitHubClient,
  repo: string,
  fromMs: number,
  toMs: number
): Promise<readonly RunAttempt[]> => {
  const runs = await listSlice(client, repo, fromMs, toMs);
  // Slices can overlap at a boundary day only if GitHub's day is not UTC; dedupe.
  return [...new Map(runs.map((run) => [run.runId, run])).values()];
};

/** Earlier attempts of re-run runs that belong to one of `prs`. */
export const fetchEarlierAttempts = async (
  client: GitHubClient,
  repo: string,
  latest: readonly RunAttempt[],
  prs: readonly MergedPr[]
): Promise<readonly RunAttempt[]> => {
  const numbers = new Set(prs.map((pr) => pr.number));
  const index = shaIndex(prs);
  const rerun = latest.filter(
    (run) =>
      run.attempt > 1 &&
      [...prsForAttempt(run, index)].some((n) => numbers.has(n))
  );
  const attempts: RunAttempt[] = [];
  for (const run of rerun) {
    for (let attempt = 1; attempt < run.attempt; attempt += 1) {
      const path = `/repos/${repo}/actions/runs/${String(run.runId)}/attempts/${String(attempt)}`;
      attempts.push(toAttempt((await client.rest(path)).json, path));
    }
  }
  return attempts;
};
