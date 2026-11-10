/**
 * The archetypes: the kinds of job this portfolio is presented for.
 *
 * Each one is a set of segments in the market landscape (hiring context ×
 * level). The set was derived from `src/data/market/landscape.json`: every
 * archetype is backed by enough postings to measure, and its demand profile
 * differs from the others enough to change what a page should lead with.
 *
 * Ids are public: `/a/<id>/` is a presentation's URL, so an id is only
 * renamed or removed deliberately (the `/portfolio-refresh` command), never by
 * a data refresh. `bun run archetypes:status` reports when the data argues for
 * a different set or a different default.
 */
import type { Context, SegmentLevel } from './landscape-types';

export type ArchetypeDefinition = {
  readonly id: string;
  /** Who reads this presentation, in one phrase. */
  readonly audience: string;
  /** What this segment of the market is and what sets it apart. */
  readonly description: string;
  readonly cells: readonly {
    readonly context: Context;
    readonly levels: readonly SegmentLevel[];
  }[];
};

const ALL_LEVELS: readonly SegmentLevel[] = ['mid', 'senior', 'staff'];

export const ARCHETYPES = [
  {
    id: 'tech-company-senior-developer',
    audience: 'Senior engineer hiring at software product companies',
    description:
      'Senior individual-contributor roles at companies whose product is software, from scale-ups to big tech. The largest segment in the sample and the level currently held, so it is the default. These postings ask for ownership of a feature area, sound system design and reliable delivery alongside product and design.',
    cells: [{ context: 'tech', levels: ['mid', 'senior'] }],
  },
  {
    id: 'tech-company-staff-engineer',
    audience: 'Staff, principal and lead hiring at software product companies',
    description:
      'Staff, principal and lead roles at the same software companies. The asks shift from building to direction: architecture, technical leadership, mentoring and working with stakeholders. Postings ask for more years than any other segment, so this is the stretch target.',
    cells: [{ context: 'tech', levels: ['staff'] }],
  },
  {
    id: 'startup-small-company-senior-developer',
    audience: 'Founders and first engineers hiring at small companies',
    description:
      'Engineers hired directly by founders at small companies, including founding-engineer roles. Titles are loose and the stack is narrow; what is asked for is someone who owns a product end to end and ships quickly. The segment the knowledge base fits best.',
    cells: [{ context: 'startup', levels: ALL_LEVELS }],
  },
  {
    id: 'corporate-large-company-senior-developer',
    audience: 'Engineering managers and recruiters at large enterprises',
    description:
      'Software engineers at large enterprises whose product is not software: banks, insurers, health systems and retailers. These postings are process-heavy and name testing, release pipelines, integrations and regulated domains far more often than the rest of the market.',
    cells: [{ context: 'corporate', levels: ['mid', 'senior'] }],
  },
  {
    id: 'corporate-contractor-systems-architect',
    audience:
      'Consultancies and enterprises hiring contract leads and architects',
    description:
      'Contract engagements and consultancies, plus lead and architect roles inside large enterprises. The work is designing and delivering systems for a client: integrations, cloud, modernization, and time spent with stakeholders.',
    cells: [
      { context: 'contract', levels: ALL_LEVELS },
      { context: 'corporate', levels: ['staff'] },
    ],
  },
] as const satisfies readonly ArchetypeDefinition[];

export type ArchetypeId = (typeof ARCHETYPES)[number]['id'];

export const ARCHETYPE_IDS: readonly ArchetypeId[] = ARCHETYPES.map(
  (archetype) => archetype.id
);

/**
 * Served at `/`; every other archetype is at `/a/<id>/`. The largest
 * segment of the landscape that the knowledge base fits well, at the level
 * currently held; `archetypes:status` recomputes the argument.
 */
export const DEFAULT_ARCHETYPE_ID: ArchetypeId =
  'tech-company-senior-developer';

/** What a valid archetype id looks like; nginx applies the same test. */
export const ARCHETYPE_ID_PATTERN = /^[a-z0-9-]{1,64}$/;

export const isArchetypeId = (value: string): value is ArchetypeId =>
  (ARCHETYPE_IDS as readonly string[]).includes(value);

export const archetypeById = (id: ArchetypeId): ArchetypeDefinition => {
  const found = ARCHETYPES.find((archetype) => archetype.id === id);
  if (found === undefined) throw new Error(`Unknown archetype: ${id}`);
  return found;
};
