/**
 * The `Check` merge gate in `.github/workflows/ci.yml`: which jobs it waits for
 * and how many job instances that is once matrices expand.
 *
 * Matrix rule (GitHub's own semantics, statically):
 *   - no `strategy.matrix` → 1 instance;
 *   - an expression matrix (`${{ fromJSON(...) }}`) or an expression-valued
 *     dimension cannot be expanded without running the workflow, so it counts
 *     as 1 — a lower bound, never an overstatement;
 *   - otherwise the cartesian product of array dimensions, minus combinations
 *     an `exclude` entry matches, plus every `include` entry that does not
 *     merge into an existing combination (an entry merges when it agrees with
 *     a combination on every original dimension it names).
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

type Row = Readonly<Record<string, unknown>>;

const isRecord = (value: unknown): value is Row =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const rows = (value: unknown): readonly Row[] =>
  Array.isArray(value) ? value.filter(isRecord) : [];

const cartesian = (
  dimensions: readonly (readonly [string, readonly unknown[]])[]
): Row[] =>
  dimensions.reduce<Row[]>(
    (combos, [key, values]) =>
      combos.flatMap((combo) =>
        values.map((value) => ({ ...combo, [key]: value }))
      ),
    [{}]
  );

const matches = (
  combo: Row,
  partial: Row,
  keys: ReadonlySet<string>
): boolean =>
  Object.entries(partial).every(
    ([key, value]) => !keys.has(key) || combo[key] === value
  );

const dimensionsOf = (matrix: Row): (readonly [string, readonly unknown[]])[] =>
  Object.entries(matrix)
    .filter(([key]) => key !== 'include' && key !== 'exclude')
    // An expression-valued dimension expands to an unknown list: count it once.
    .map(
      ([key, value]) => [key, Array.isArray(value) ? value : [value]] as const
    );

export const matrixInstances = (matrix: unknown): number => {
  if (!isRecord(matrix)) return 1;
  const dimensions = dimensionsOf(matrix);
  const keys = new Set(dimensions.map(([key]) => key));
  const excluded = rows(matrix['exclude']);
  const base =
    dimensions.length === 0
      ? []
      : cartesian(dimensions).filter(
          (combo) => !excluded.some((entry) => matches(combo, entry, keys))
        );
  const added = rows(matrix['include']).filter(
    (entry) => !base.some((combo) => matches(combo, entry, keys))
  );
  return Math.max(1, base.length + added.length);
};

export type CheckGate = {
  readonly jobs: readonly string[];
  readonly instances: number;
};

const needsOf = (job: Row | undefined): readonly string[] => {
  const needs = job?.['needs'];
  if (typeof needs === 'string') return [needs];
  if (Array.isArray(needs) && needs.every((entry) => typeof entry === 'string'))
    return needs;
  throw new Error('ci.yml: the Check job declares no `needs` list');
};

const findCheckJob = (jobs: Row): Row | undefined =>
  Object.values(jobs)
    .filter(isRecord)
    .find((job) => job['name'] === 'Check');

const instancesOf = (job: unknown): number => {
  const strategy = isRecord(job) ? job['strategy'] : undefined;
  return isRecord(strategy) ? matrixInstances(strategy['matrix']) : 1;
};

/** Parses ci.yml with Bun's YAML parser; no dependency is added for it. */
export const readCheckGate = (root: string): CheckGate => {
  const source = readFileSync(join(root, '.github/workflows/ci.yml'), 'utf8');
  const workflow: unknown = Bun.YAML.parse(source);
  const jobs = isRecord(workflow) ? workflow['jobs'] : undefined;
  if (!isRecord(jobs)) throw new Error('ci.yml: no jobs mapping');
  const needs = needsOf(findCheckJob(jobs));
  const missing = needs.filter((id) => !isRecord(jobs[id]));
  if (missing.length > 0) {
    throw new Error(`ci.yml: Check needs unknown jobs ${missing.join(', ')}`);
  }
  const instances = needs.reduce(
    (total, id) => total + instancesOf(jobs[id]),
    0
  );
  return { jobs: needs, instances };
};
