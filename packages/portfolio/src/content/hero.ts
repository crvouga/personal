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
  statement:
    'I ship software where mistakes are expensive. I write the spec and the automated checks first, so AI coding agents can move fast without lowering the bar.',
  statementSecondary:
    'Senior engineer in health and education technology. I own features from the data model to the interface, and I led engineering on a university transfer-credit platform.',
  /** Short enough to sit on one line of the pill at any width. */
  availability: 'Open to senior and staff roles',
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
