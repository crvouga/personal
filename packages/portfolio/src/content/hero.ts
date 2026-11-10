import {
  IDENTITY,
  LOGISTICS as KNOWN_LOGISTICS,
  WORK_PREFERENCE,
  type Logistics as KnownLogistics,
} from '../knowledge/identity';
import { DEFAULT_ROLE_ID } from '../roles/definitions';
import { VOICES } from '../roles/voice';
import type { Topic } from './topic';

/** `/` speaks in the default role's voice; so does every feed. */
const VOICE = VOICES[DEFAULT_ROLE_ID];

/**
 * Identity is declared once. The page title, the eyebrow, the footer, the
 * structured data and the monogram all derive from these three, so a change of
 * level or city is a one-line edit rather than a search.
 */
export const NAME = IDENTITY.name;

export const ROLE = IDENTITY.title;

export const LOCATION = `${IDENTITY.location.city}, ${IDENTITY.location.region}`;

export const MONOGRAM_INITIALS = NAME.split(' ')
  .map((word) => word.charAt(0))
  .join('');

/** Hero panel stack line; every entry appears in at least one PROJECTS entry. */
export const CORE_STACK: readonly Topic[] = [
  'typescript',
  'react',
  'nodejs',
  'postgres',
  'aws',
  'docker',
];

/**
 * The pitch, and the résumé summary. `statement` is the differentiator — the
 * method and what it buys — and is the largest text after the name; it is also
 * the meta description, so it must fit a search snippet. `statementSecondary`
 * is the scope and the domains. Neither names an employer, a tenure or a
 * stack: those are derived from `work.ts` and the project registry.
 */
export const HERO = {
  name: NAME,
  eyebrow: VOICE.eyebrow,
  /** One plain sentence a non-engineer can repeat. No project names, no figures. */
  statement: VOICE.statement,
  /** Scope and domains: the résumé summary and LinkedIn About; not in the hero. */
  statementSecondary: VOICE.statementSecondary,
  /**
   * Worded for someone already in a senior role: selective interest, not a
   * job search. The pill wraps on narrow phones rather than overflowing.
   */
  availability: VOICE.availability,
  /** Where I am, and the one preference a screener filters on. */
  location: `${LOCATION} · ${WORK_PREFERENCE}`,
  ctaPrimary: {
    label: 'Email',
  },
  /** Label for the secondary copy-to-clipboard control beside the address. */
  ctaCopyLabel: 'Copy',
};

/** The first filters a recruiter applies; see `knowledge/identity.ts`. */
export type Logistics = KnownLogistics;

export const LOGISTICS: Logistics = KNOWN_LOGISTICS;

/** Logistics in display order, without the unset ones. */
export const logisticsLines = (logistics: Logistics = LOGISTICS): string[] =>
  [
    logistics.authorization,
    logistics.timeZone,
    logistics.start,
    logistics.replyTime,
  ].filter((line): line is string => line !== undefined && line !== '');
