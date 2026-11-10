/**
 * The committed market snapshot, `src/data/market/landscape.json`: what job
 * postings ask for, per hiring segment. Written by `bun run market:refresh`
 * and only read by the site build.
 */
import type { Theme } from '../knowledge/themes';

export const LANDSCAPE_VERSION = 1;

export type Context = 'startup' | 'tech' | 'corporate' | 'contract';
export type SegmentLevel = 'mid' | 'senior' | 'staff';

/** The kind of role a title names; see `scripts/market/titles.ts`. */
export type JobFamily =
  | 'manager'
  | 'ml-research'
  | 'data'
  | 'security'
  | 'embedded'
  | 'qa'
  | 'architect'
  | 'platform'
  | 'mobile'
  | 'frontend'
  | 'fullstack'
  | 'backend'
  | 'ai-product'
  | 'generalist';

/** A phrase postings use, and how distinctive it is to the segment. */
export type PhraseDemand = {
  readonly text: string;
  readonly share: number;
  readonly lift: number;
};

/** `share` is the fraction of the segment's postings that mention it. */
export type SkillDemand = {
  readonly id: string;
  readonly label: string;
  readonly share: number;
  /** Share here ÷ share across all eligible postings; >1 is distinctive. */
  readonly lift: number;
  /** Whether the knowledge base holds evidence of it. */
  readonly have: boolean;
};

export type ThemeDemand = {
  readonly id: Theme;
  readonly share: number;
  readonly lift: number;
};

export type Sample = {
  readonly title: string;
  readonly company: string;
  readonly url: string;
};

export type Segment = {
  readonly context: Context;
  /** Set on a family segment: every context, one kind of role. */
  readonly family?: JobFamily;
  readonly level: SegmentLevel;
  readonly postings: number;
  /** Fraction of all eligible postings that fall in this segment. */
  readonly share: number;
  /** Mean fraction of a posting's named skills the knowledge base evidences. */
  readonly fit: number;
  readonly yearsMedian: number | null;
  readonly salaryMedian: number | null;
  readonly families: readonly { readonly id: string; readonly share: number }[];
  readonly skills: readonly SkillDemand[];
  readonly themes: readonly ThemeDemand[];
  readonly samples: readonly Sample[];
  /** Distinctive phrases the segment's postings use, strongest first. */
  readonly phrases?: readonly PhraseDemand[];
};

export type Landscape = {
  readonly version: number;
  readonly generatedAt: string;
  readonly sources: readonly {
    readonly id: string;
    readonly postings: number;
  }[];
  readonly totals: {
    readonly fetched: number;
    readonly eligible: number;
    readonly needsClearance: number;
    readonly outOfScope: number;
  };
  readonly segments: readonly Segment[];
  /** The same measurements by role family × level, across every context. */
  readonly jobFamilySegments?: readonly Segment[];
  /** Most-requested skills the knowledge base has no evidence for. */
  readonly gaps: readonly SkillDemand[];
};
