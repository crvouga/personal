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
 * The pitch, and the resume summary. It names what does not change — the scope
 * owned, the domains, the way of working — and leaves the current employer,
 * tenure and stack to the parts of the page that derive them from `work.ts`
 * and the project registry.
 */
export const HERO = {
  name: NAME,
  eyebrow: `// ${ROLE.toLowerCase()}`,
  statement:
    'I build and own production software end to end, from the data model to the interface, in education and health — domains where being wrong is expensive.',
  statementSecondary:
    'I work spec-first: define what correct means, then build the automated verification that lets AI coding agents move fast without lowering the bar.',
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
