import type { Topic } from './topic';

/**
 * Identity is declared once. The page title, the eyebrow, the footer, the
 * structured data and the monogram all derive from these three, so a change of
 * level or city is a one-line edit rather than a search.
 */
export const NAME = 'Chris Vouga';

export const ROLE = 'Senior Software Engineer';

export const LOCATION = 'Phoenix, AZ';

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
  eyebrow: `// ${ROLE.toLowerCase()}`,
  /** One plain sentence a non-engineer can repeat. No project names, no figures. */
  statement:
    'I build reliable software with AI coding agents, and the automated checks that keep it correct.',
  /** Scope and domains: the résumé summary and LinkedIn About; not in the hero. */
  statementSecondary:
    'Senior engineer in health and education software. Previously technical lead on a university transfer-credit platform.',
  /**
   * Worded for someone already in a senior role: selective interest, not a
   * job search. The pill wraps on narrow phones rather than overflowing.
   */
  availability: 'Open to conversations about staff roles',
  /** Where I am, and the one preference a screener filters on. */
  location: `${LOCATION} · open to remote`,
  ctaPrimary: {
    label: 'Email',
  },
  /** Label for the secondary copy-to-clipboard control beside the address. */
  ctaCopyLabel: 'Copy',
};

/**
 * The first filters a recruiter applies. Only what is known is rendered; an
 * unset field is an open question in CONTENT_QUESTIONS.md, never a guess.
 */
export type Logistics = {
  readonly authorization?: string;
  readonly timeZone?: string;
  readonly start?: string;
  readonly replyTime?: string;
};

export const LOGISTICS: Logistics = {
  authorization: 'US citizen · no sponsorship needed',
  // Arizona does not observe daylight saving time, so this is true all year.
  timeZone: 'UTC−7 (Arizona, no daylight saving)',
};

/** Logistics in display order, without the unset ones. */
export const logisticsLines = (logistics: Logistics = LOGISTICS): string[] =>
  [
    logistics.authorization,
    logistics.timeZone,
    logistics.start,
    logistics.replyTime,
  ].filter((line): line is string => line !== undefined && line !== '');
