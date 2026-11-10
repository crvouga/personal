/**
 * Postings → the landscape: for each hiring segment (context × level), how
 * often each skill and theme is asked for, and how well the knowledge base
 * answers it.
 */
import {
  LANDSCAPE_VERSION,
  type Context,
  type Landscape,
  type Sample,
  type Segment,
  type SegmentLevel,
  type SkillDemand,
  type ThemeDemand,
} from '../../src/archetypes/landscape-types';
import { THEME_IDS } from '../../src/knowledge/themes';
import type { Features } from './extract';
import { SKILLS } from '../../src/archetypes/skills';
import type { Posting } from './types';

const CONTEXTS: readonly Context[] = [
  'startup',
  'tech',
  'corporate',
  'contract',
];
const LEVELS: readonly SegmentLevel[] = ['mid', 'senior', 'staff'];
const TOP_SKILLS = 30;
const TOP_GAPS = 12;
const SAMPLES = 5;
const DECIMALS = 1000;

const round = (value: number): number =>
  Math.round(value * DECIMALS) / DECIMALS;

const median = (values: readonly number[]): number | null => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? null;
};

/** id → fraction of `rows` whose list contains it. */
const shares = (
  rows: readonly Features[],
  pick: (row: Features) => readonly string[]
): Map<string, number> => {
  const counts = new Map<string, number>();
  for (const id of rows.flatMap((row) => [...new Set(pick(row))])) {
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return new Map(
    [...counts].map(([id, count]) => [id, count / Math.max(rows.length, 1)])
  );
};

const lift = (share: number, baseline: number | undefined): number =>
  baseline === undefined || baseline === 0 ? 1 : round(share / baseline);

type Inputs = {
  readonly postings: ReadonlyMap<string, Posting>;
  readonly have: ReadonlySet<string>;
  readonly baseSkills: ReadonlyMap<string, number>;
  readonly baseThemes: ReadonlyMap<string, number>;
  readonly eligible: number;
};

const skillDemand = (
  rows: readonly Features[],
  inputs: Inputs
): SkillDemand[] => {
  const share = shares(rows, (row) => row.skills);
  return SKILLS.filter((skill) => share.has(skill.id))
    .map((skill) => ({
      id: skill.id,
      label: skill.label,
      share: round(share.get(skill.id) ?? 0),
      lift: lift(share.get(skill.id) ?? 0, inputs.baseSkills.get(skill.id)),
      have: inputs.have.has(skill.id),
    }))
    .sort((a, b) => b.share - a.share);
};

const themeDemand = (
  rows: readonly Features[],
  inputs: Inputs
): ThemeDemand[] => {
  const share = shares(rows, (row) => row.themes);
  return THEME_IDS.map((id) => ({
    id,
    share: round(share.get(id) ?? 0),
    lift: lift(share.get(id) ?? 0, inputs.baseThemes.get(id)),
  })).sort((a, b) => b.share - a.share);
};

/** Mean share of each posting's named skills that the knowledge base backs. */
const fitOf = (
  rows: readonly Features[],
  have: ReadonlySet<string>
): number => {
  const scored = rows
    .filter((row) => row.skills.length > 0)
    .map(
      (row) =>
        row.skills.filter((skill) => have.has(skill)).length / row.skills.length
    );
  return scored.length === 0
    ? 0
    : round(scored.reduce((sum, value) => sum + value, 0) / scored.length);
};

/** One per company first, so the samples show the segment's breadth. */
const samplesOf = (rows: readonly Features[], inputs: Inputs): Sample[] => {
  const seen = new Set<string>();
  const samples: Sample[] = [];
  for (const row of rows) {
    const posting = inputs.postings.get(row.id);
    if (posting === undefined || seen.has(posting.company)) continue;
    seen.add(posting.company);
    samples.push({
      title: posting.title,
      company: posting.company,
      url: posting.url,
    });
  }
  return samples.slice(0, SAMPLES);
};

const segmentOf = (
  context: Context,
  level: SegmentLevel,
  rows: readonly Features[],
  inputs: Inputs
): Segment => ({
  context,
  level,
  postings: rows.length,
  share: round(rows.length / Math.max(inputs.eligible, 1)),
  fit: fitOf(rows, inputs.have),
  yearsMedian: median(rows.flatMap((row) => row.years ?? [])),
  salaryMedian: median(rows.flatMap((row) => row.salary ?? [])),
  families: [...shares(rows, (row) => [row.family])]
    .map(([id, share]) => ({ id, share: round(share) }))
    .sort((a, b) => b.share - a.share),
  skills: skillDemand(rows, inputs).slice(0, TOP_SKILLS),
  themes: themeDemand(rows, inputs),
  samples: samplesOf(rows, inputs),
});

export type AggregateInput = {
  readonly postings: readonly Posting[];
  readonly features: readonly Features[];
  readonly have: ReadonlySet<string>;
  readonly sources: Landscape['sources'];
  readonly generatedAt: string;
};

export const aggregate = (input: AggregateInput): Landscape => {
  const eligible = input.features.filter((row) => row.eligible);
  const inputs: Inputs = {
    postings: new Map(input.postings.map((posting) => [posting.id, posting])),
    have: input.have,
    baseSkills: shares(eligible, (row) => row.skills),
    baseThemes: shares(eligible, (row) => row.themes),
    eligible: eligible.length,
  };
  const segments = CONTEXTS.flatMap((context) =>
    LEVELS.map((level) =>
      segmentOf(
        context,
        level,
        eligible.filter(
          (row) => row.context === context && row.level === level
        ),
        inputs
      )
    )
  );
  const needsClearance = input.features.filter((row) => row.clearance).length;
  return {
    version: LANDSCAPE_VERSION,
    generatedAt: input.generatedAt,
    sources: input.sources,
    totals: {
      fetched: input.features.length,
      eligible: eligible.length,
      needsClearance,
      outOfScope: input.features.length - eligible.length - needsClearance,
    },
    segments,
    gaps: skillDemand(eligible, inputs)
      .filter((skill) => !skill.have)
      .slice(0, TOP_GAPS),
  };
};
