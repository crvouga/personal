/**
 * What one archetype's postings ask for: its landscape segments merged,
 * weighted by how many postings each holds.
 */
import type { Theme } from '../knowledge/themes';
import {
  DEFAULT_ARCHETYPE_ID,
  archetypeById,
  type ArchetypeDefinition,
} from './definitions';
import { LANDSCAPE } from './landscape';
import type { Landscape, Segment } from './landscape-types';

export type Demand = {
  readonly postings: number;
  /** Fraction of all eligible postings. */
  readonly share: number;
  /** Mean fraction of a posting's skills the knowledge base evidences. */
  readonly fit: number;
  readonly yearsMedian: number | null;
  readonly salaryMedian: number | null;
  /** Skill id → fraction of this archetype's postings that name it. */
  readonly skills: ReadonlyMap<string, number>;
  /** Skill id → how distinctive it is here (1 = as common as everywhere). */
  readonly skillLift: ReadonlyMap<string, number>;
  readonly themes: ReadonlyMap<Theme, number>;
  readonly themeLift: ReadonlyMap<Theme, number>;
};

export const segmentsOf = (
  archetype: ArchetypeDefinition,
  landscape: Landscape = LANDSCAPE
): Segment[] =>
  landscape.segments.filter((segment) =>
    archetype.cells.some(
      (cell) =>
        cell.context === segment.context && cell.levels.includes(segment.level)
    )
  );

type Weighted = { readonly id: string; readonly value: number };

/** Posting-weighted mean of a per-segment figure, keyed by id. */
const merge = <K extends string>(
  segments: readonly Segment[],
  pick: (segment: Segment) => readonly Weighted[]
): Map<K, number> => {
  const total = segments.reduce((sum, segment) => sum + segment.postings, 0);
  const merged = new Map<K, number>();
  for (const segment of segments) {
    for (const { id, value } of pick(segment)) {
      const key = id as K;
      merged.set(
        key,
        (merged.get(key) ?? 0) + (value * segment.postings) / Math.max(total, 1)
      );
    }
  }
  return merged;
};

const weightedMean = (
  segments: readonly Segment[],
  pick: (segment: Segment) => number | null
): number | null => {
  const known = segments.filter((segment) => pick(segment) !== null);
  const total = known.reduce((sum, segment) => sum + segment.postings, 0);
  if (total === 0) return null;
  return (
    known.reduce(
      (sum, segment) => sum + (pick(segment) ?? 0) * segment.postings,
      0
    ) / total
  );
};

export const demandFor = (
  archetype: ArchetypeDefinition,
  landscape: Landscape = LANDSCAPE
): Demand => {
  const segments = segmentsOf(archetype, landscape);
  const share = (rows: readonly { id: string; share: number }[]): Weighted[] =>
    rows.map((row) => ({ id: row.id, value: row.share }));
  const lift = (rows: readonly { id: string; lift: number }[]): Weighted[] =>
    rows.map((row) => ({ id: row.id, value: row.lift }));
  return {
    postings: segments.reduce((sum, segment) => sum + segment.postings, 0),
    share: segments.reduce((sum, segment) => sum + segment.share, 0),
    fit: weightedMean(segments, (segment) => segment.fit) ?? 0,
    yearsMedian: weightedMean(segments, (segment) => segment.yearsMedian),
    salaryMedian: weightedMean(segments, (segment) => segment.salaryMedian),
    skills: merge(segments, (segment) => share(segment.skills)),
    skillLift: merge(segments, (segment) => lift(segment.skills)),
    themes: merge<Theme>(segments, (segment) => share(segment.themes)),
    themeLift: merge<Theme>(segments, (segment) => lift(segment.themes)),
  };
};

/** The demand behind `/`: what the default archetype's postings ask for. */
export const DEFAULT_DEMAND: Demand = demandFor(
  archetypeById(DEFAULT_ARCHETYPE_ID)
);

/**
 * How much an archetype is worth optimising for: a segment is attractive when
 * it is both large and well matched. The square root keeps a huge, poorly
 * matched segment from outranking a smaller one the knowledge base fits.
 */
export const opportunity = (demand: Demand): number =>
  demand.fit * Math.sqrt(demand.share);
