/**
 * The role index (`/roles/`) and each role's own page
 * (`/roles/<id>/`): the evidence that justifies it. Everything here is read from the committed landscape and
 * the knowledge base, so the page cannot claim a number the data lacks.
 */
import { CAPABLE_SKILLS } from '../knowledge/capabilities';
import { THEMES, THEME_IDS, type Theme } from '../knowledge/themes';
import {
  ROLES,
  DEFAULT_ROLE_ID,
  type RoleDefinition,
  type RoleId,
} from './definitions';
import {
  cellLabel,
  demandFor,
  opportunity,
  segmentsOf,
  type Demand,
} from './demand';
import { LANDSCAPE } from './landscape';
import type { Sample } from './landscape-types';
import { roleDetailsHref, presentationFor } from './presentation';
import { SKILLS } from './skills';
import { researchFor } from '../market/research';
import type { RoleResearch } from '../market/schema';

const TOP_THEMES = 6;
const TOP_SKILLS = 10;
const SAMPLES = 4;
/** A theme this rare is noise however distinctive it looks. */
const MIN_DISTINCTIVE_SHARE = 0.2;

export type Bar = {
  readonly label: string;
  /** Fraction of the role's postings that ask for it. */
  readonly share: number;
  /** Share here ÷ share across the whole sample. */
  readonly lift: number;
};

export type SkillBar = Bar & {
  /** Whether the knowledge base holds evidence of it. */
  readonly have: boolean;
};

export type Stat = { readonly label: string; readonly value: string };

export type RoleCard = {
  readonly id: RoleId;
  readonly isDefault: boolean;
  readonly audience: string;
  readonly description: string;
  /** Which landscape segments it covers, e.g. `tech: mid, senior`. */
  readonly covers: readonly string[];
  /** One sentence: the numbers that earn this role its place. */
  readonly justification: string;
  readonly stats: readonly Stat[];
  readonly themes: readonly Bar[];
  readonly skills: readonly SkillBar[];
  readonly samples: readonly Sample[];
  /** The pitch this presentation leads with. */
  readonly statement: string;
  readonly availability: string;
  /** The presentation itself: `/` or `/a/<id>/`. */
  readonly href: string;
  readonly resumeHref: string;
  /** This role's page in the index: `/roles/<id>/`. */
  readonly detailsHref: string;
  /** Where it ranks by opportunity, from 1. */
  readonly rank: number;
  /** The cited market research behind its wording, résumé and look. */
  readonly research: RoleResearch;
};

export const percent = (value: number): string =>
  `${String(Math.round(value * 100))}%`;

const dollars = (value: number | null): string =>
  value === null ? 'n/a' : `$${String(Math.round(value / 1000))}k`;

const themeBars = (demand: Demand): Bar[] =>
  THEME_IDS.map((id) => ({
    label: THEMES[id],
    share: demand.themes.get(id) ?? 0,
    lift: demand.themeLift.get(id) ?? 1,
  })).sort((a, b) => b.share * b.lift - a.share * a.lift);

const skillBars = (demand: Demand): SkillBar[] =>
  SKILLS.map((skill) => ({
    label: skill.label,
    share: demand.skills.get(skill.id) ?? 0,
    lift: demand.skillLift.get(skill.id) ?? 1,
    have: CAPABLE_SKILLS.has(skill.id),
  })).sort((a, b) => b.share - a.share);

/** The request that most sets this role apart from the rest. */
const mostDistinctive = (demand: Demand): Bar | undefined =>
  themeBars(demand)
    .filter((bar) => bar.share >= MIN_DISTINCTIVE_SHARE)
    .sort((a, b) => b.lift - a.lift)[0];

const justify = (demand: Demand): string => {
  const distinctive = mostDistinctive(demand);
  const base = `${String(demand.postings)} postings, ${percent(demand.share)} of the sample; the knowledge base backs ${percent(demand.fit)} of the skills they name.`;
  return distinctive === undefined
    ? base
    : `${base} Most distinctive request: ${distinctive.label.toLowerCase()}, asked for ${distinctive.lift.toFixed(1)}× as often as in the sample overall.`;
};

const statsOf = (demand: Demand): Stat[] => [
  { label: 'Postings', value: String(demand.postings) },
  { label: 'Share of sample', value: percent(demand.share) },
  { label: 'Skill fit', value: percent(demand.fit) },
  { label: 'Opportunity', value: opportunity(demand).toFixed(2) },
  {
    label: 'Median years asked',
    value: demand.yearsMedian === null ? 'n/a' : demand.yearsMedian.toFixed(0),
  },
  { label: 'Median posted pay', value: dollars(demand.salaryMedian) },
];

const cardOf = (role: RoleDefinition): RoleCard => {
  const id = role.id as RoleId;
  const demand = demandFor(role);
  const presentation = presentationFor(id);
  return {
    id,
    isDefault: id === DEFAULT_ROLE_ID,
    audience: role.audience,
    description: role.description,
    covers: role.cells.map(cellLabel),
    justification: justify(demand),
    stats: statsOf(demand),
    themes: themeBars(demand).slice(0, TOP_THEMES),
    skills: skillBars(demand).slice(0, TOP_SKILLS),
    samples: segmentsOf(role)
      .flatMap((segment) => segment.samples)
      .slice(0, SAMPLES),
    statement: presentation.voice.statement,
    availability: presentation.voice.availability,
    href: presentation.home,
    resumeHref: presentation.resumeHref,
    detailsHref: roleDetailsHref(id),
    rank: 0,
    research: researchFor(id),
  };
};

/** Highest opportunity first: the order they are worth optimising for. */
export const ROLE_CARDS: readonly RoleCard[] = ROLES.map(cardOf)
  .map((card, index) => ({
    card,
    score: opportunity(demandFor(ROLES[index] as RoleDefinition)),
  }))
  .sort((a, b) => b.score - a.score)
  .map(({ card }, index) => ({ ...card, rank: index + 1 }));

export const cardById = (id: RoleId): RoleCard => {
  const found = ROLE_CARDS.find((card) => card.id === id);
  if (found === undefined) throw new Error(`Unknown role: ${id}`);
  return found;
};

export const LANDSCAPE_SUMMARY = {
  date: LANDSCAPE.generatedAt,
  fetched: LANDSCAPE.totals.fetched,
  eligible: LANDSCAPE.totals.eligible,
  needsClearance: LANDSCAPE.totals.needsClearance,
  outOfScope: LANDSCAPE.totals.outOfScope,
  sources: LANDSCAPE.sources,
  gaps: LANDSCAPE.gaps.map((gap) => ({
    label: gap.label,
    share: gap.share,
  })),
} as const;

export type { Theme };
