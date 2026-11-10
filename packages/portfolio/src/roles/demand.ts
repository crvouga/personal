/**
 * What one role's postings ask for: its landscape segments merged,
 * weighted by how many postings each holds.
 */
import type { Theme } from '../knowledge/themes';
import {
  DEFAULT_ROLE_ID,
  roleById,
  type RoleDefinition,
  type Cell,
} from './definitions';
import { LANDSCAPE } from './landscape';
import { RESEARCH } from '../market/research';
import type { Landscape, Segment } from './landscape-types';

export type Demand = {
  readonly postings: number;
  /** Fraction of all eligible postings. */
  readonly share: number;
  /** Mean fraction of a posting's skills the knowledge base evidences. */
  readonly fit: number;
  readonly yearsMedian: number | null;
  readonly salaryMedian: number | null;
  /** Skill id → fraction of this role's postings that name it. */
  readonly skills: ReadonlyMap<string, number>;
  /** Skill id → how distinctive it is here (1 = as common as everywhere). */
  readonly skillLift: ReadonlyMap<string, number>;
  readonly themes: ReadonlyMap<Theme, number>;
  readonly themeLift: ReadonlyMap<Theme, number>;
  /** Phrase → share of this role's employers using it, distinctive first. */
  readonly phrases: ReadonlyMap<string, number>;
  readonly phraseLift: ReadonlyMap<string, number>;
  /**
   * Theme → how decisive the market research says it is to this reader, 0–1:
   * the weight of the criteria that name it (their first theme in full, the
   * rest at half), relative to the strongest. Empty when the role has no market research.
   */
  readonly research: ReadonlyMap<Theme, number>;
};

/** A criterion's later themes are context for it, not the thing itself. */
const SECONDARY_THEME_SHARE = 0.5;

export const researchWeights = (
  criteria: readonly { weight: number; themes: readonly Theme[] }[]
): Map<Theme, number> => {
  const raw = new Map<Theme, number>();
  for (const criterion of criteria) {
    criterion.themes.forEach((theme, index) => {
      const part = index === 0 ? 1 : SECONDARY_THEME_SHARE;
      raw.set(theme, (raw.get(theme) ?? 0) + criterion.weight * part);
    });
  }
  const top = Math.max(1, ...raw.values());
  return new Map([...raw].map(([theme, value]) => [theme, value / top]));
};

/** The landscape segments a cell selects: by hiring context, or by family. */
export const segmentsOfCell = (
  cell: Cell,
  landscape: Landscape = LANDSCAPE
): Segment[] =>
  'family' in cell
    ? (landscape.jobFamilySegments ?? []).filter(
        (segment) =>
          segment.family === cell.family && cell.levels.includes(segment.level)
      )
    : landscape.segments.filter(
        (segment) =>
          segment.context === cell.context &&
          cell.levels.includes(segment.level)
      );

export const segmentsOf = (
  role: RoleDefinition,
  landscape: Landscape = LANDSCAPE
): Segment[] => role.cells.flatMap((cell) => segmentsOfCell(cell, landscape));

/** `tech: mid, senior` or `ai-product roles: mid, senior, staff`. */
export const cellLabel = (cell: Cell): string =>
  'family' in cell
    ? `${cell.family} roles: ${cell.levels.join(', ')}`
    : `${cell.context}: ${cell.levels.join(', ')}`;

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
  role: RoleDefinition,
  landscape: Landscape = LANDSCAPE
): Demand => {
  const segments = segmentsOf(role, landscape);
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
    phrases: merge(segments, (segment) =>
      (segment.phrases ?? []).map((row) => ({ id: row.text, value: row.share }))
    ),
    phraseLift: merge(segments, (segment) =>
      (segment.phrases ?? []).map((row) => ({ id: row.text, value: row.lift }))
    ),
    research: researchWeights(RESEARCH.get(role.id)?.criteria ?? []),
  };
};

/** The demand behind `/`: what the default role's postings ask for. */
export const DEFAULT_DEMAND: Demand = demandFor(roleById(DEFAULT_ROLE_ID));

/**
 * How much a role is worth optimising for: a segment is attractive when
 * it is both large and well matched. The square root keeps a huge, poorly
 * matched segment from outranking a smaller one the knowledge base fits.
 */
export const opportunity = (demand: Demand): number =>
  demand.fit * Math.sqrt(demand.share);
