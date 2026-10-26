/**
 * Per-repository facts from the REST API: commit count on the default branch,
 * open issues and PRs, license, and the default branch's latest CI result.
 *
 * Primary CI workflow, in order of preference:
 *   1. the active workflow named exactly `CI` (case-insensitive) — in
 *      crvouga/mockingbird that is `pr.yml`, while its `ci.yml` is "Release";
 *   2. the active workflow whose file is `ci.yml` / `ci.yaml`;
 *   3. otherwise whichever workflow ran the most recent completed `push` run
 *      on the default branch (crvouga/headless-combobox has only `CD`).
 * For 1 and 2 the workflow's latest *completed* run on the default branch (any
 * event) supplies the conclusion; for 3 that push run does. No completed run
 * gives `null`.
 */

import type { RepoStats } from '../../src/lib/verification';
import { countViaLastPage, type GitHubClient } from './github-client';
import {
  arrayAt,
  nullableStringAt,
  numberAt,
  recordAt,
  stringAt,
  toRecord,
} from './json-fields';

type Workflow = {
  readonly id: number;
  readonly name: string;
  readonly path: string;
  readonly state: string;
};

type CiResult = Pick<
  RepoStats,
  | 'defaultBranchCiWorkflow'
  | 'defaultBranchCiConclusion'
  | 'defaultBranchCiRunUrl'
  | 'defaultBranchCiCompletedAt'
>;

const NO_CI: CiResult = {
  defaultBranchCiWorkflow: null,
  defaultBranchCiConclusion: null,
  defaultBranchCiRunUrl: null,
  defaultBranchCiCompletedAt: null,
};

const searchCount = async (
  client: GitHubClient,
  query: string
): Promise<number> => {
  const path = `/search/issues?q=${encodeURIComponent(query)}&per_page=1`;
  return numberAt((await client.rest(path)).json, 'total_count', path);
};

const listWorkflows = async (
  client: GitHubClient,
  repo: string
): Promise<readonly Workflow[]> => {
  const path = `/repos/${repo}/actions/workflows?per_page=100`;
  return arrayAt((await client.rest(path)).json, 'workflows', path).map(
    (entry) => ({
      id: numberAt(entry, 'id', path),
      name: stringAt(entry, 'name', path),
      path: stringAt(entry, 'path', path),
      state: stringAt(entry, 'state', path),
    })
  );
};

export const pickPrimaryWorkflow = (
  workflows: readonly Workflow[]
): Workflow | undefined => {
  const active = workflows.filter((workflow) => workflow.state === 'active');
  return (
    active.find((workflow) => workflow.name.toLowerCase() === 'ci') ??
    active.find((workflow) => /(?:^|\/)ci\.ya?ml$/.test(workflow.path))
  );
};

const firstRun = async (
  client: GitHubClient,
  path: string
): Promise<Record<string, unknown> | null> =>
  toRecord(arrayAt((await client.rest(path)).json, 'workflow_runs', path)[0]);

const toCiResult = (
  run: Record<string, unknown> | null,
  where: string
): CiResult =>
  run === null
    ? NO_CI
    : {
        defaultBranchCiWorkflow: stringAt(run, 'name', where),
        defaultBranchCiConclusion: nullableStringAt(run, 'conclusion', where),
        defaultBranchCiRunUrl: stringAt(run, 'html_url', where),
        defaultBranchCiCompletedAt: stringAt(run, 'updated_at', where),
      };

const latestCi = async (
  client: GitHubClient,
  repo: string,
  branch: string
): Promise<CiResult> => {
  const workflow = pickPrimaryWorkflow(await listWorkflows(client, repo));
  const scope = `branch=${encodeURIComponent(branch)}&status=completed&per_page=1`;
  if (workflow !== undefined) {
    const path = `/repos/${repo}/actions/workflows/${String(workflow.id)}/runs?${scope}`;
    return toCiResult(await firstRun(client, path), path);
  }
  const path = `/repos/${repo}/actions/runs?${scope}&event=push`;
  return toCiResult(await firstRun(client, path), path);
};

export const fetchRepoStats = async (
  client: GitHubClient,
  repo: string
): Promise<RepoStats> => {
  const where = `/repos/${repo}`;
  const meta = (await client.rest(where)).json;
  const branch = stringAt(meta, 'default_branch', where);
  const license =
    toRecord(meta)?.['license'] === null
      ? null
      : recordAt(meta, 'license', where);
  return {
    repo,
    url: stringAt(meta, 'html_url', where),
    defaultBranch: branch,
    stars: numberAt(meta, 'stargazers_count', where),
    commits: await countViaLastPage(
      client,
      `${where}/commits?sha=${encodeURIComponent(branch)}&per_page=1`
    ),
    openIssues: await searchCount(client, `repo:${repo} type:issue state:open`),
    openPrs: await searchCount(client, `repo:${repo} type:pr state:open`),
    license:
      license === null ? null : nullableStringAt(license, 'spdx_id', where),
    ...(await latestCi(client, repo, branch)),
  };
};
