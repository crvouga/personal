#!/usr/bin/env bun
/**
 * Refresh the committed verification snapshot, `src/data/verification.json`.
 *
 * Strict like refresh-github-insights.ts: any API or clone failure exits
 * non-zero and leaves the committed file untouched, because a refresh that
 * quietly kept yesterday's numbers would report success forever. The site
 * build never runs this — it only reads the committed JSON.
 *
 * API budget (crvouga/workspace today): ~4 GraphQL pages for merged PRs and
 * their commit messages, ~6 REST pages of `pull_request` runs, one request per
 * earlier attempt of a re-run PR run, and ~7 requests per repository.
 *
 * Usage (from packages/portfolio):
 *   GITHUB_TOKEN=$(gh auth token) bun run refresh-verification
 */
import { appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { errorMessage } from '../src/lib/github-error';
import {
  VERIFICATION_VERSION,
  parseVerificationSnapshot,
  type VerificationSnapshot,
  type WorkspacePrStats,
} from '../src/lib/verification';
import { writeLine } from '../src/library/cli-output';
import {
  aiCoAuthoredPrNumbers,
  partitionPrs,
  prsFailedBeforeMerge,
  type MergedPr,
} from './verification/ci-join';
import { AUTOMATION_BRANCHES } from './verification/classify';
import {
  readCloneStats,
  readMockingbirdStats,
} from './verification/clone-stats';
import {
  createClient,
  resolveToken,
  type GitHubClient,
} from './verification/github-client';
import { fetchMockingbirdCatalog } from './verification/catalog';
import { fetchRepoStats } from './verification/repo-stats';
import {
  fetchEarlierAttempts,
  listPullRequestRuns,
} from './verification/workflow-runs';
import { fetchMergedPrs } from './verification/workspace-prs';
import { writeJson } from './verification/write-json';

const WORKSPACE = 'crvouga/workspace';
const REPOS = ['crvouga/mockingbird', 'crvouga/headless-combobox', WORKSPACE];
const WINDOW_DAYS = 90;
const DAY_MS = 86_400_000;

const snapshotPath = resolve(import.meta.dir, '../src/data/verification.json');

const day = (ms: number): string => new Date(ms).toISOString().slice(0, 10);
const startOfDay = (ms: number): number => Date.parse(`${day(ms)}T00:00:00Z`);

export type Window = { readonly fromMs: number; readonly toMs: number };

/** max(today − 90 days, the day of the repository's first merged PR) → now. */
export const windowFor = (prs: readonly MergedPr[], nowMs: number): Window => {
  const first = Math.min(...prs.map((pr) => Date.parse(pr.mergedAt)));
  if (!Number.isFinite(first))
    throw new Error(`${WORKSPACE} has no merged PRs`);
  const fromMs = Math.max(
    startOfDay(nowMs) - WINDOW_DAYS * DAY_MS,
    startOfDay(first)
  );
  return { fromMs, toMs: nowMs };
};

const workspaceStats = async (
  client: GitHubClient,
  nowMs: number
): Promise<{ stats: WorkspacePrStats; window: Window }> => {
  const prs = await fetchMergedPrs(client, WORKSPACE);
  const window = windowFor(prs, nowMs);
  const { human, automated } = partitionPrs(prs, window.fromMs, window.toMs);
  const earliestPr = Math.min(
    window.fromMs,
    ...human.map((pr) => Date.parse(pr.createdAt))
  );
  const latest = await listPullRequestRuns(
    client,
    WORKSPACE,
    earliestPr,
    window.toMs
  );
  const earlier = await fetchEarlierAttempts(client, WORKSPACE, latest, human);
  const failed = prsFailedBeforeMerge(human, [...latest, ...earlier]);
  const ai = aiCoAuthoredPrNumbers(human);
  return {
    window,
    stats: {
      repo: WORKSPACE,
      mergedPrs: human.length,
      automatedPrsExcluded: automated.length,
      automationPatterns: [...AUTOMATION_BRANCHES],
      prsFailedCiBeforeMerge: failed.length,
      prsFailedCiBeforeMergeNumbers: failed,
      aiCoAuthoredPrs: ai.length,
      aiCoAuthoredPrNumbers: ai,
      pullRequestRunsExamined: latest.length,
      earlierAttemptsExamined: earlier.length,
    },
  };
};

const fetchSnapshot = async (
  client: GitHubClient,
  now: Date
): Promise<VerificationSnapshot> => {
  const { stats, window } = await workspaceStats(client, now.getTime());
  const repos = [];
  for (const repo of REPOS) repos.push(await fetchRepoStats(client, repo));
  return parseVerificationSnapshot({
    version: VERIFICATION_VERSION,
    fetchedAt: now.toISOString(),
    window: { from: day(window.fromMs), to: day(window.toMs) },
    workspace: stats,
    repos,
    mockingbird: readMockingbirdStats('crvouga/mockingbird'),
    mockingbirdCatalog: await fetchMockingbirdCatalog(),
    headlessCombobox: readCloneStats('crvouga/headless-combobox'),
  });
};

const summarize = (snapshot: VerificationSnapshot): string => {
  const { workspace, mockingbird } = snapshot;
  return (
    `${snapshot.window.from}..${snapshot.window.to}: ${String(workspace.prsFailedCiBeforeMerge)}/` +
    `${String(workspace.mergedPrs)} human PRs failed CI before merge ` +
    `(${String(workspace.automatedPrsExcluded)} automated excluded), ` +
    `${String(workspace.aiCoAuthoredPrs)} AI co-authored; mockingbird ` +
    `${String(mockingbird.emulators)} emulators, ${String(mockingbird.testCallSites)} test call sites.`
  );
};

const main = async (): Promise<void> => {
  try {
    const snapshot = await fetchSnapshot(
      createClient(resolveToken()),
      new Date()
    );
    const changed = await writeJson(snapshot, snapshotPath);
    writeLine(summarize(snapshot));
    const output = process.env['GITHUB_OUTPUT'];
    if (output !== undefined && output !== '') {
      appendFileSync(
        output,
        `verification_changed=${String(changed)}\n`,
        'utf8'
      );
    }
    process.exit(0);
  } catch (error) {
    writeLine(`Verification refresh failed: ${errorMessage(error)}`);
    writeLine(
      'The committed snapshot was left untouched; the site keeps rendering it.'
    );
    process.exit(1);
  }
};

if (import.meta.main) await main();
