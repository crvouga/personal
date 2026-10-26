/**
 * Computes {@link PlatformFacts} from a monorepo checkout. Shared by the CLI
 * (`scripts/platform-facts.ts`) and the drift test, so both run the same code.
 */

import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  PLATFORM_FACTS_VERSION,
  type AiCoAuthorTrailers,
  type PlatformFacts,
} from '../../src/lib/platform-facts';
import { readCheckGate } from './facts-ci';
import {
  canCountHistory,
  countAiTrailers,
  countRepoCallSites,
  listRepoFiles,
} from './facts-git';
import {
  countHealthChecks,
  countPreventDestroy,
  countWorkspacePackages,
  readAgentHarnesses,
  readInventoryServices,
  readOpenTofuRoots,
  readRequiredChecks,
} from './facts-sources';

/** packages/portfolio/scripts/verification → repository root. */
export const MONOREPO_ROOT = resolve(import.meta.dir, '../../../..');

/** Relative to the package root. */
export const FACTS_RELATIVE_PATH = 'src/data/platform-facts.json';

const REQUIRED_PATHS = [
  '.git',
  '.github/workflows/ci.yml',
  'packages/infra/tofu/modules/inventory/inventory.tf.json',
  'packages/infra/lib/health/run.ts',
  'scripts/agent-commands.ts',
];

/**
 * False inside the Docker build, whose context is only `packages/portfolio`
 * plus workspace manifests — there is nothing there to compute facts from.
 */
export const isMonorepoPresent = (root = MONOREPO_ROOT): boolean =>
  REQUIRED_PATHS.every((path) => existsSync(join(root, path)));

export type ComputeOptions = {
  readonly root?: string;
  /** Commit whose history is counted for trailers; defaults to `HEAD`. */
  readonly historyRef?: string;
};

export const computePlatformFacts = (
  options: ComputeOptions = {}
): PlatformFacts => {
  const root = options.root ?? MONOREPO_ROOT;
  const files = listRepoFiles(root);
  const gate = readCheckGate(root);
  const tests = countRepoCallSites(root);
  return {
    version: PLATFORM_FACTS_VERSION,
    requiredChecks: readRequiredChecks(root),
    checkGateJobs: gate.jobs,
    checkGateJobInstances: gate.instances,
    openTofuRoots: readOpenTofuRoots(root),
    preventDestroyGuards: countPreventDestroy(root, files),
    healthChecks: countHealthChecks(root),
    inventoryServices: readInventoryServices(root),
    packages: countWorkspacePackages(files),
    workspaceTestFiles: tests.files,
    workspaceTestCallSites: tests.callSites,
    agentCommandHarnesses: readAgentHarnesses(root),
    aiCoAuthorTrailers: countAiTrailers(root, options.historyRef ?? 'HEAD'),
  };
};

export type DriftCheck = {
  readonly recomputed: PlatformFacts;
  /** Set when the pinned commit's history is not in this checkout. */
  readonly historySkipped: string | null;
};

/**
 * Recomputes the facts the way the committed file claims they were computed:
 * trailers are counted at the commit the file pins, not at today's `HEAD`.
 * When that history is absent (a shallow CI clone) the committed trailer
 * counts are carried over and the skip is reported, never silently passed.
 */
export const recomputeForCheck = (
  committed: PlatformFacts,
  root = MONOREPO_ROOT
): DriftCheck => {
  const pinned = committed.aiCoAuthorTrailers.asOfCommit;
  if (canCountHistory(root, pinned)) {
    return {
      recomputed: computePlatformFacts({ root, historyRef: pinned }),
      historySkipped: null,
    };
  }
  const recomputed = computePlatformFacts({ root, historyRef: 'HEAD' });
  const trailers: AiCoAuthorTrailers = committed.aiCoAuthorTrailers;
  return {
    recomputed: { ...recomputed, aiCoAuthorTrailers: trailers },
    historySkipped: `commit ${pinned} or its history is not in this checkout`,
  };
};

export const serializeFacts = (facts: PlatformFacts): string =>
  `${JSON.stringify(facts, null, 2)}\n`;
