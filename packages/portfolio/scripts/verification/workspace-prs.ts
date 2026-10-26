/**
 * Every merged PR of a repository with its commits, through GraphQL: one
 * request returns 50 PRs with up to 100 commit messages each, where REST
 * would need a request per PR. PRs with more than 100 commits page their
 * commits separately.
 */

import type { MergedPr, PrCommit } from './ci-join';
import type { GitHubClient } from './github-client';
import {
  arrayAt,
  booleanAt,
  numberAt,
  recordAt,
  stringAt,
  toRecord,
} from './json-fields';

const COMMIT_FIELDS = `pageInfo { hasNextPage endCursor }
  nodes { commit { oid message } }`;

const PRS_QUERY = `query($owner: String!, $name: String!, $cursor: String) {
  repository(owner: $owner, name: $name) {
    pullRequests(states: MERGED, first: 50, after: $cursor, orderBy: { field: CREATED_AT, direction: ASC }) {
      pageInfo { hasNextPage endCursor }
      nodes {
        number createdAt mergedAt headRefName
        author { __typename login }
        commits(first: 100) { ${COMMIT_FIELDS} }
      }
    }
  }
}`;

const COMMITS_QUERY = `query($owner: String!, $name: String!, $number: Int!, $cursor: String) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) { commits(first: 100, after: $cursor) { ${COMMIT_FIELDS} } }
  }
}`;

const WHERE = 'GraphQL pullRequests';

type Page = {
  readonly nodes: readonly unknown[];
  readonly next: string | null;
};

const pageOf = (connection: Record<string, unknown>): Page => {
  const info = recordAt(connection, 'pageInfo', WHERE);
  return {
    nodes: arrayAt(connection, 'nodes', WHERE),
    next: booleanAt(info, 'hasNextPage', WHERE)
      ? stringAt(info, 'endCursor', WHERE)
      : null,
  };
};

const toCommit = (node: unknown): PrCommit => {
  const commit = recordAt(node, 'commit', WHERE);
  return {
    oid: stringAt(commit, 'oid', WHERE),
    message: stringAt(commit, 'message', WHERE),
  };
};

type Repo = { readonly owner: string; readonly name: string };

const remainingCommits = async (
  client: GitHubClient,
  repo: Repo,
  number: number,
  first: string
): Promise<readonly PrCommit[]> => {
  const commits: PrCommit[] = [];
  let cursor: string | null = first;
  while (cursor !== null) {
    const data = await client.graphql(COMMITS_QUERY, {
      ...repo,
      number,
      cursor,
    });
    const pr = recordAt(
      recordAt(data, 'repository', WHERE),
      'pullRequest',
      WHERE
    );
    const page = pageOf(recordAt(pr, 'commits', WHERE));
    commits.push(...page.nodes.map(toCommit));
    cursor = page.next;
  }
  return commits;
};

const toPr = async (
  client: GitHubClient,
  repo: Repo,
  node: unknown
): Promise<MergedPr> => {
  const number = numberAt(node, 'number', WHERE);
  const author = toRecord(toRecord(node)?.['author']);
  const commits = pageOf(recordAt(node, 'commits', WHERE));
  const rest =
    commits.next === null
      ? []
      : await remainingCommits(client, repo, number, commits.next);
  return {
    number,
    createdAt: stringAt(node, 'createdAt', WHERE),
    mergedAt: stringAt(node, 'mergedAt', WHERE),
    headRefName: stringAt(node, 'headRefName', WHERE),
    // A deleted account ("ghost") has no author; it is not automation.
    authorLogin: author === null ? null : stringAt(author, 'login', WHERE),
    authorIsBot: author?.['__typename'] === 'Bot',
    commits: [...commits.nodes.map(toCommit), ...rest],
  };
};

export const fetchMergedPrs = async (
  client: GitHubClient,
  fullName: string
): Promise<readonly MergedPr[]> => {
  const [owner = '', name = ''] = fullName.split('/');
  const repo = { owner, name };
  const prs: MergedPr[] = [];
  let cursor: string | null = null;
  do {
    const data = await client.graphql(PRS_QUERY, { ...repo, cursor });
    const page = pageOf(
      recordAt(recordAt(data, 'repository', WHERE), 'pullRequests', WHERE)
    );
    for (const node of page.nodes) prs.push(await toPr(client, repo, node));
    cursor = page.next;
  } while (cursor !== null);
  return prs;
};
