/**
 * One measured line per résumé project, rendered from the committed snapshots
 * (proof-view). A project without one falls back to its card description, so
 * nothing here is typed by hand.
 */
import { PLATFORM_FACTS, VERIFICATION, count } from '../lib/proof-view';

const SNAPSHOT = VERIFICATION.snapshot;

const OUTCOMES: Readonly<Record<string, () => string>> = {
  mockingbird: () =>
    `${count(SNAPSHOT.mockingbirdCatalog.services)} stateful vendor-API emulators, published to npm and checked against the vendors’ OpenAPI contracts by property-based parity tests.`,
  'workspace-platform': () =>
    `Runs ${count(PLATFORM_FACTS.inventoryServices)} services on OpenTofu-only infrastructure; ${count(PLATFORM_FACTS.checkGateJobInstances)} CI jobs gate every merge and stopped ${count(SNAPSHOT.workspace.prsFailedCiBeforeMerge)} of ${count(SNAPSHOT.workspace.mergedPrs)} pull requests.`,
};

export const resumeOutcomeFor = (projectId: string): string | null =>
  OUTCOMES[projectId]?.() ?? null;
