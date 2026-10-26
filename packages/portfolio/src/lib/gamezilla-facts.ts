/**
 * gamezilla's specification counts, from `src/data/gamezilla-facts.json`
 * (written by `scripts/gamezilla-facts.ts`, run by hand because the repository
 * is private). Validated on load; a malformed file fails the build.
 */
import raw from '../data/gamezilla-facts.json';

export type GamezillaFacts = {
  readonly version: 1;
  /** YYYY-MM-DD the counts were taken; printed beside them. */
  readonly asOf: string;
  readonly commit: string;
  readonly commits: number;
  /** Gherkin `.feature` files under specs/. */
  readonly behaviorSpecs: number;
  readonly scenarios: number;
  /** Quint models of what can happen over time. */
  readonly stateModels: number;
  /** Alloy models of which stored states are valid. */
  readonly structureModels: number;
  /** DMN decision tables. */
  readonly decisionTables: number;
  /** OpenSLO objectives. */
  readonly serviceObjectives: number;
  readonly propertyTestFiles: number;
};

const COUNTS = [
  'commits',
  'behaviorSpecs',
  'scenarios',
  'stateModels',
  'structureModels',
  'decisionTables',
  'serviceObjectives',
  'propertyTestFiles',
] as const;

export const parseGamezillaFacts = (value: unknown): GamezillaFacts => {
  const record = value as Record<string, unknown> | null;
  const valid =
    typeof record === 'object' &&
    record !== null &&
    record['version'] === 1 &&
    typeof record['asOf'] === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(record['asOf']) &&
    typeof record['commit'] === 'string' &&
    COUNTS.every(
      (key) => Number.isInteger(record[key]) && (record[key] as number) >= 0
    );
  if (!valid) {
    throw new Error(
      'src/data/gamezilla-facts.json is malformed; regenerate it with `bun run gamezilla-facts`.'
    );
  }
  return record as unknown as GamezillaFacts;
};

export const GAMEZILLA_FACTS: GamezillaFacts = parseGamezillaFacts(raw);
