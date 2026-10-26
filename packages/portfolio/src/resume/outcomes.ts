/**
 * One measured line per résumé project, rendered from the committed snapshots
 * (proof-view). A project without one falls back to its card description, so
 * nothing here is typed by hand.
 */
import { PLATFORM_FACTS, VERIFICATION, count } from '../lib/proof-view';
import { GAMEZILLA_FACTS } from '../lib/gamezilla-facts';
import { repoStatsFor } from '../lib/verification';

const SNAPSHOT = VERIFICATION.snapshot;

const OUTCOMES: Readonly<Record<string, () => string>> = {
  mockingbird: () =>
    `${count(SNAPSHOT.mockingbirdCatalog.services)} stateful vendor-API emulators, published to npm and checked against the vendors’ OpenAPI contracts by property-based parity tests.`,
  'workspace-platform': () =>
    `Runs ${count(PLATFORM_FACTS.inventoryServices)} services on OpenTofu-only infrastructure; ${count(PLATFORM_FACTS.checkGateJobInstances)} CI jobs gate every merge, and ${count(SNAPSHOT.workspace.prsFailedCiBeforeMerge)} of ${count(SNAPSHOT.workspace.mergedPrs)} pull requests failed CI before merging green.`,
  gamezilla: () =>
    `Local-first multiplayer game app defined by ${count(GAMEZILLA_FACTS.scenarios)} executable spec scenarios and ${count(GAMEZILLA_FACTS.stateModels)} formal state models that every pull request must pass.`,
  'headless-combobox': () =>
    `Accessible, framework-agnostic combobox published on npm as an open-source library; ${count(stars('crvouga/headless-combobox'))} GitHub stars.`,
};

const stars = (repo: string): number =>
  repoStatsFor(SNAPSHOT, repo)?.stars ?? 0;

export const resumeOutcomeFor = (projectId: string): string | null =>
  OUTCOMES[projectId]?.() ?? null;
