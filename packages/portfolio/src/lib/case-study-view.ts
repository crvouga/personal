/**
 * The numbers in each case study's Outcome section, derived from the committed
 * snapshots. Case-study prose never types a figure; it frames these.
 */
import { repoStatsFor } from './verification';
import { PLATFORM_FACTS, VERIFICATION, count } from './proof-view';

export type OutcomeFact = {
  readonly value: string;
  readonly label: string;
};

const SNAPSHOT = VERIFICATION.snapshot;

const ciLine = (repo: string): OutcomeFact[] => {
  const stats = repoStatsFor(SNAPSHOT, repo);
  if (stats === undefined || stats.defaultBranchCiConclusion === null)
    return [];
  return [
    {
      value:
        stats.defaultBranchCiConclusion === 'success'
          ? 'Green'
          : stats.defaultBranchCiConclusion,
      label: `latest ${stats.defaultBranchCiWorkflow ?? 'CI'} run on ${stats.defaultBranch}`,
    },
  ];
};

const repoLines = (repo: string): OutcomeFact[] => {
  const stats = repoStatsFor(SNAPSHOT, repo);
  if (stats === undefined) return [];
  return [
    { value: count(stats.commits), label: 'commits on the default branch' },
    { value: count(stats.openIssues), label: 'open issues' },
    ...ciLine(repo),
  ];
};

const mockingbird = (): OutcomeFact[] => {
  const catalog = SNAPSHOT.mockingbirdCatalog;
  const repo = SNAPSHOT.mockingbird;
  return [
    {
      value: count(catalog.services),
      label: 'service emulators in the published catalog',
    },
    {
      value: `${count(catalog.opsSupported)} of ${count(catalog.opsTotal)}`,
      label: 'vendor operations supported',
    },
    {
      value: count(repo.publishedPackages),
      label: 'packages published to npm',
    },
    {
      value: count(repo.wipEmulators),
      label: 'emulators still marked work in progress',
    },
    {
      value: count(repo.propertyTestFiles),
      label: 'property-based test suites',
    },
    { value: count(repo.testCallSites), label: 'tests' },
    ...repoLines('crvouga/mockingbird'),
  ];
};

const workspace = (): OutcomeFact[] => {
  const ws = SNAPSHOT.workspace;
  return [
    {
      value: count(PLATFORM_FACTS.inventoryServices),
      label: 'hosted services declared in one inventory',
    },
    {
      value: count(PLATFORM_FACTS.openTofuRoots.length),
      label: 'OpenTofu roots, each validated on every pull request',
    },
    {
      value: count(PLATFORM_FACTS.preventDestroyGuards),
      label: 'resources guarded against deletion',
    },
    {
      value: count(PLATFORM_FACTS.healthChecks),
      label: 'health-check groups in the daily report',
    },
    {
      value: count(PLATFORM_FACTS.checkGateJobInstances),
      label: `CI jobs behind ${count(PLATFORM_FACTS.requiredChecks.length)} required checks`,
    },
    { value: count(PLATFORM_FACTS.workspaceTestCallSites), label: 'tests' },
    {
      value: `${count(ws.prsFailedCiBeforeMerge)} of ${count(ws.mergedPrs)}`,
      label: `pull requests stopped by CI before merge, since ${SNAPSHOT.window.from}`,
    },
    ...repoLines('crvouga/workspace'),
  ];
};

const BY_PROJECT: Readonly<Record<string, () => OutcomeFact[]>> = {
  mockingbird,
  'workspace-platform': workspace,
};

export const outcomeFactsFor = (projectId: string): readonly OutcomeFact[] =>
  BY_PROJECT[projectId]?.() ?? [];

/** As of when: the snapshot the figures were read from. */
export const OUTCOME_AS_OF = SNAPSHOT.fetchedAt.slice(0, 10);
