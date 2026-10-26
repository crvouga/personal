/**
 * The numbers in each case study's Outcome section, derived from the committed
 * snapshots. Case-study prose never types a figure; it frames these.
 */
import { GAMEZILLA_FACTS } from './gamezilla-facts';
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
      label: `latest run of its “${stats.defaultBranchCiWorkflow ?? 'CI'}” workflow on ${stats.defaultBranch}; other scheduled workflows are reported separately on GitHub`,
    },
  ];
};

const repoLines = (repo: string): OutcomeFact[] => {
  const stats = repoStatsFor(SNAPSHOT, repo);
  if (stats === undefined) return [];
  return [
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

const gamezilla = (): OutcomeFact[] => {
  const f = GAMEZILLA_FACTS;
  return [
    {
      value: count(f.scenarios),
      label: `executable scenarios across ${count(f.behaviorSpecs)} behavior specs`,
    },
    {
      value: count(f.stateModels),
      label: 'Quint models of what can happen over time',
    },
    {
      value: count(f.structureModels),
      label: 'Alloy models of which stored states are legal',
    },
    {
      value: count(f.decisionTables),
      label: 'decision tables for who may do what',
    },
    { value: count(f.serviceObjectives), label: 'service-level objectives' },
    {
      value: count(f.propertyTestFiles),
      label: 'property-based test files, seeds pinned',
    },
  ];
};

const BY_PROJECT: Readonly<Record<string, () => OutcomeFact[]>> = {
  mockingbird,
  gamezilla,
  'workspace-platform': workspace,
};

export const outcomeFactsFor = (projectId: string): readonly OutcomeFact[] =>
  BY_PROJECT[projectId]?.() ?? [];

/** As of when: the snapshot each case study's figures were read from. */
export const outcomeAsOf = (projectId: string): string =>
  projectId === 'gamezilla'
    ? `${GAMEZILLA_FACTS.asOf}, at commit ${GAMEZILLA_FACTS.commit}`
    : SNAPSHOT.fetchedAt.slice(0, 10);
