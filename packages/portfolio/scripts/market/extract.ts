/**
 * One posting → the handful of features the aggregator counts. Everything
 * here is a regular expression over text the fetchers already normalised, so
 * a refresh costs network time and no model tokens.
 */
import { THEME_IDS, type Theme } from '../../src/knowledge/themes';
import { SKILLS } from '../../src/archetypes/skills';
import { THEME_PATTERNS } from './taxonomy';
import {
  RELEVANT_FAMILIES,
  familyOf,
  levelOf,
  type Family,
  type Level,
} from './titles';
import type { Posting } from './types';

/** The four hiring contexts a presentation can be tailored to. */
export type Context = 'startup' | 'tech' | 'corporate' | 'contract';

export type Features = {
  readonly id: string;
  readonly context: Context;
  readonly level: Level;
  readonly family: Family;
  /** A role this candidate could credibly apply to, in a place they can work. */
  readonly eligible: boolean;
  readonly clearance: boolean;
  readonly years: number | null;
  readonly salary: number | null;
  readonly skills: readonly string[];
  readonly themes: readonly Theme[];
};

export const contextOf = (posting: Posting): Context => {
  if (posting.employment === 'contract' || posting.band === 'consultancy') {
    return 'contract';
  }
  if (posting.band === 'enterprise') return 'corporate';
  return posting.band === 'startup' ? 'startup' : 'tech';
};

const ELSEWHERE =
  /\b(india|bangalore|bengaluru|hyderabad|pune|chennai|gurgaon|noida|london|uk|united kingdom|ireland|dublin|germany|berlin|munich|france|paris|spain|madrid|barcelona|portugal|lisbon|poland|warsaw|krak[oó]w|romania|netherlands|amsterdam|sweden|stockholm|switzerland|zurich|singapore|japan|tokyo|australia|sydney|melbourne|canada|toronto|vancouver|montreal|brazil|s[aã]o paulo|mexico|argentina|colombia|israel|tel aviv|china|shanghai|korea|seoul|emea|apac|latam|europe|philippines|manila|vietnam|thailand|costa rica|serbia|ukraine|turkey|uae|dubai|egypt|nigeria|kenya|south africa)\b/i;
const UNITED_STATES =
  /\b(United States|USA|US|U\.S\.|Americas|North America)\b|, [A-Z]{2}\b/;

/** Remote-anywhere counts; a role pinned to another country does not. */
export const inReach = (location: string): boolean =>
  !ELSEWHERE.test(location) || UNITED_STATES.test(location);

const CLEARANCE =
  /\b(security clearance|secret clearance|ts\/sci|top secret|polygraph|active clearance|dod clearance|clearance (is )?required)\b/i;

const YEARS =
  /(\d{1,2})\+?(?:\s*(?:-|–|to)\s*\d{1,2})?\s*\+?\s*(?:years?|yrs?)[^.;]{0,60}?experience/gi;
const MAX_PLAUSIBLE_YEARS = 15;

/** The highest "N years of experience" a posting states, or null. */
export const yearsRequired = (text: string): number | null => {
  const found = [...text.matchAll(YEARS)]
    .map((match) => Number(match[1]))
    .filter((years) => years >= 1 && years <= MAX_PLAUSIBLE_YEARS);
  return found.length === 0 ? null : Math.max(...found);
};

const DOLLARS = /\$\s?(\d{2,3})(?:,(\d{3})|\s?k\b)/gi;
const MIN_SALARY = 60_000;
const MAX_SALARY = 600_000;

/** Midpoint of the annual USD figures a posting states, or null. */
export const salaryMidpoint = (text: string): number | null => {
  const found = [...text.matchAll(DOLLARS)]
    .map((match) => Number(match[1]) * 1000 + Number(match[2] ?? 0))
    .filter((amount) => amount >= MIN_SALARY && amount <= MAX_SALARY);
  if (found.length === 0) return null;
  return Math.round((Math.min(...found) + Math.max(...found)) / 2);
};

export const extract = (posting: Posting): Features => {
  const text = `${posting.title} ${posting.text}`;
  const family = familyOf(posting.title);
  const level = levelOf(posting.title);
  const clearance = CLEARANCE.test(text);
  return {
    id: posting.id,
    context: contextOf(posting),
    level,
    family,
    eligible:
      RELEVANT_FAMILIES.has(family) &&
      level !== 'junior' &&
      !clearance &&
      inReach(posting.location),
    clearance,
    years: yearsRequired(text),
    salary: salaryMidpoint(text),
    skills: SKILLS.filter((skill) => skill.pattern.test(text)).map(
      (skill) => skill.id
    ),
    themes: THEME_IDS.filter((theme) => THEME_PATTERNS[theme].test(text)),
  };
};
