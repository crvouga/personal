/**
 * Postings → the landscape: for each hiring segment (context × level), how
 * often each skill and theme is asked for, and how well the knowledge base
 * answers it.
 */
import {
  LANDSCAPE_VERSION,
  type Context,
  type JobFamily,
  type PhraseDemand,
  type Landscape,
  type Sample,
  type Segment,
  type SegmentLevel,
  type SkillDemand,
  type ThemeDemand,
} from '../../src/roles/landscape-types';
import { THEME_IDS } from '../../src/knowledge/themes';
import type { Features } from './extract';
import { SKILLS } from '../../src/roles/skills';
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
const TOP_PHRASES = 30;
/** A phrase fewer postings than this use is an accident of wording. */
const MIN_PHRASE_SHARE = 0.04;
/** A phrase this much likelier here than everywhere is distinctive. */
const MIN_PHRASE_LIFT = 1.25;
const MAX_PHRASE_LIFT = 3;
/** Role families that get their own segments, beside hiring contexts. */
const FAMILY_SEGMENTS: readonly JobFamily[] = [
  'ai-product',
  'platform',
  'fullstack',
  'architect',
];
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
  readonly basePhrases: ReadonlyMap<string, number>;
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

/**
 * id → fraction of the companies in `rows` whose postings use it. A phrase
 * one employer repeats in every posting is its template, not the market's.
 */
export const companyShares = (
  rows: readonly Features[],
  pick: (row: Features) => readonly string[]
): Map<string, number> => {
  const byCompany = new Map<string, Set<string>>();
  for (const row of rows) {
    const seen = byCompany.get(row.company) ?? new Set<string>();
    for (const id of pick(row)) seen.add(id);
    byCompany.set(row.company, seen);
  }
  const counts = new Map<string, number>();
  for (const id of [...byCompany.values()].flatMap((seen) => [...seen])) {
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return new Map(
    [...counts].map(([id, count]) => [id, count / Math.max(byCompany.size, 1)])
  );
};

/** Phrases this segment's employers use more than the market's do. */
const phraseDemand = (
  rows: readonly Features[],
  inputs: Inputs
): PhraseDemand[] =>
  [...companyShares(rows, (row) => row.phrases)]
    .filter(([, share]) => share >= MIN_PHRASE_SHARE)
    .map(([text, share]) => ({
      text,
      share: round(share),
      lift: lift(share, inputs.basePhrases.get(text)),
    }))
    .filter((phrase) => phrase.lift >= MIN_PHRASE_LIFT)
    .sort(
      (a, b) =>
        b.share * Math.min(b.lift, MAX_PHRASE_LIFT) -
          a.share * Math.min(a.lift, MAX_PHRASE_LIFT) ||
        a.text.localeCompare(b.text)
    )
    // A three-word phrase repeats the two-word one inside it; keep one.
    .filter(
      (phrase, index, all) =>
        !all
          .slice(0, index)
          .some(
            (kept) =>
              kept.text.includes(phrase.text) || phrase.text.includes(kept.text)
          )
    )
    .slice(0, TOP_PHRASES);

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

type SegmentKey = {
  readonly context: Context;
  readonly level: SegmentLevel;
  /** Set for a role-family segment, which spans every context. */
  readonly family?: JobFamily | undefined;
};

const segmentOf = (
  { context, level, family }: SegmentKey,
  rows: readonly Features[],
  inputs: Inputs
): Segment => ({
  context,
  ...(family === undefined ? {} : { family }),
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
  phrases: phraseDemand(rows, inputs),
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
    basePhrases: companyShares(eligible, (row) => row.phrases),
    eligible: eligible.length,
  };
  const segments = CONTEXTS.flatMap((context) =>
    LEVELS.map((level) =>
      segmentOf(
        { context, level },
        eligible.filter(
          (row) => row.context === context && row.level === level
        ),
        inputs
      )
    )
  );
  // Every context, one kind of role: `context` holds the commonest one.
  const jobFamilySegments = FAMILY_SEGMENTS.flatMap((family) =>
    LEVELS.map((level) => {
      const rows = eligible.filter(
        (row) => row.family === family && row.level === level
      );
      const contexts = [...shares(rows, (row) => [row.context])].sort(
        (a, b) => b[1] - a[1]
      );
      const context = (contexts[0]?.[0] ?? 'tech') as Context;
      return segmentOf({ context, level, family }, rows, inputs);
    })
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
    jobFamilySegments,
    gaps: skillDemand(eligible, inputs)
      .filter((skill) => !skill.have)
      .slice(0, TOP_GAPS),
  };
};
