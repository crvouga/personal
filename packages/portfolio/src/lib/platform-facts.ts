/**
 * Platform facts: numbers about this monorepo, computed from its own files.
 *
 * The Docker build context holds only `packages/portfolio`, so the site cannot
 * derive these at build time. `scripts/platform-facts.ts` computes them from
 * the repository and writes `src/data/platform-facts.json`; this module only
 * reads that file. `src/data/platform-facts.test.ts` recomputes the facts
 * whenever the monorepo is present and fails on drift, so the committed values
 * cannot quietly disagree with the code they describe.
 *
 * Nothing in the file is hand-typed. Validation is structural and strict: a
 * malformed or hand-edited file throws, failing the build loudly instead of
 * rendering a wrong number.
 */

import raw from '../data/platform-facts.json';

export const PLATFORM_FACTS_VERSION = 1;

export const AI_TOOLS = ['Claude Code', 'Cursor'] as const;

export type AiTool = (typeof AI_TOOLS)[number];

export type AiTrailerCount = {
  readonly tool: AiTool;
  /** `Co-Authored-By:` trailer lines naming the tool, any model. */
  readonly trailers: number;
};

export type AiCoAuthorTrailers = {
  /**
   * The commit whose history was counted. History moves with every merge, so
   * the count is pinned to a commit to stay reproducible.
   */
  readonly asOfCommit: string;
  /** Committer date of {@link asOfCommit}, ISO 8601. */
  readonly asOfDate: string;
  /** Commits reachable from {@link asOfCommit}. */
  readonly commits: number;
  readonly byTool: readonly AiTrailerCount[];
};

export type PlatformFacts = {
  readonly version: typeof PLATFORM_FACTS_VERSION;
  /** Required status-check contexts on `main`, from the OpenTofu inventory. */
  readonly requiredChecks: readonly string[];
  /** Job ids the `Check` job in ci.yml `needs`. */
  readonly checkGateJobs: readonly string[];
  /** Matrix-expanded job instances behind {@link checkGateJobs}. */
  readonly checkGateJobInstances: number;
  /** Directories under `packages/infra/tofu/` that are OpenTofu roots. */
  readonly openTofuRoots: readonly string[];
  /** `prevent_destroy = true` occurrences across tracked `*.tf` files. */
  readonly preventDestroyGuards: number;
  /** Groups registered in `HEALTH_GROUPS` (`bun run health`). */
  readonly healthChecks: number;
  /** Hosted services in the inventory (`locals.inventory.services`). */
  readonly inventoryServices: number;
  /** Bun workspace packages (`packages/<name>/package.json`). */
  readonly packages: number;
  /** Test files scanned for {@link workspaceTestCallSites}. */
  readonly workspaceTestFiles: number;
  /** `test(`/`it(` call sites (incl. modifiers) across the workspace. */
  readonly workspaceTestCallSites: number;
  /** Harnesses `scripts/agent-commands.ts` links agent commands into. */
  readonly agentCommandHarnesses: readonly string[];
  readonly aiCoAuthorTrailers: AiCoAuthorTrailers;
};

const fail = (detail: string): never => {
  throw new Error(
    `src/data/platform-facts.json is malformed: ${detail}. ` +
      'Regenerate it with `bun run facts` from packages/portfolio.'
  );
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const count = (record: Record<string, unknown>, key: string): number => {
  const value = record[key];
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    return fail(`${key} must be a non-negative integer`);
  }
  return value;
};

const text = (record: Record<string, unknown>, key: string): string => {
  const value = record[key];
  if (typeof value !== 'string' || value.length === 0) {
    return fail(`${key} must be a non-empty string`);
  }
  return value;
};

const isNameList = (value: unknown): value is readonly string[] =>
  Array.isArray(value) &&
  value.length > 0 &&
  value.every((entry) => typeof entry === 'string' && entry.length > 0);

const names = (
  record: Record<string, unknown>,
  key: string
): readonly string[] => {
  const value = record[key];
  return isNameList(value) ? value : fail(`${key} must list names`);
};

const isAiTool = (value: unknown): value is AiTool =>
  AI_TOOLS.some((tool) => tool === value);

const parseTrailerCount = (value: unknown): AiTrailerCount => {
  if (!isRecord(value) || !isAiTool(value['tool'])) {
    return fail('aiCoAuthorTrailers.byTool entries need a known tool');
  }
  return { tool: value['tool'], trailers: count(value, 'trailers') };
};

const parseTrailers = (value: unknown): AiCoAuthorTrailers => {
  if (!isRecord(value)) return fail('aiCoAuthorTrailers must be an object');
  const byTool = value['byTool'];
  if (!Array.isArray(byTool) || byTool.length !== AI_TOOLS.length) {
    return fail('aiCoAuthorTrailers.byTool must cover every tool');
  }
  return {
    asOfCommit: text(value, 'asOfCommit'),
    asOfDate: text(value, 'asOfDate'),
    commits: count(value, 'commits'),
    byTool: byTool.map(parseTrailerCount),
  };
};

/** Throws on anything that is not a complete, current-version facts file. */
export const parsePlatformFacts = (value: unknown): PlatformFacts => {
  if (!isRecord(value)) return fail('expected an object');
  if (value['version'] !== PLATFORM_FACTS_VERSION) {
    return fail(`version must be ${String(PLATFORM_FACTS_VERSION)}`);
  }
  return {
    version: PLATFORM_FACTS_VERSION,
    requiredChecks: names(value, 'requiredChecks'),
    checkGateJobs: names(value, 'checkGateJobs'),
    checkGateJobInstances: count(value, 'checkGateJobInstances'),
    openTofuRoots: names(value, 'openTofuRoots'),
    preventDestroyGuards: count(value, 'preventDestroyGuards'),
    healthChecks: count(value, 'healthChecks'),
    inventoryServices: count(value, 'inventoryServices'),
    packages: count(value, 'packages'),
    workspaceTestFiles: count(value, 'workspaceTestFiles'),
    workspaceTestCallSites: count(value, 'workspaceTestCallSites'),
    agentCommandHarnesses: names(value, 'agentCommandHarnesses'),
    aiCoAuthorTrailers: parseTrailers(value['aiCoAuthorTrailers']),
  };
};

let cached: PlatformFacts | null = null;

/** The committed facts, validated once per process. */
export const loadPlatformFacts = (): PlatformFacts => {
  cached ??= parsePlatformFacts(raw);
  return cached;
};

/** Trailer count for one tool; 0 when the tool is absent. */
export const trailersFor = (facts: PlatformFacts, tool: AiTool): number =>
  facts.aiCoAuthorTrailers.byTool.find((entry) => entry.tool === tool)
    ?.trailers ?? 0;
