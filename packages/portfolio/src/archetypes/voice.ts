/**
 * Voice: the hand-written words of one archetype's presentation.
 *
 * Everything else a presentation shows is ranked from the knowledge base;
 * these few lines are the part a script cannot derive. They restate facts the
 * knowledge base already holds, in the vocabulary that archetype's postings
 * use, and obey the same copy rules as the rest of the site
 * (`archetypes.test.ts`): no typed numbers, years or technology names.
 *
 * `basedOn` records the inputs a voice was written against, so
 * `bun run archetypes:status` can tell which voices a market or knowledge
 * change has made stale. Only those need rewriting.
 */
import type { SectionId } from '../content/sections';
import type { ArchetypeId } from './definitions';

export type Voice = {
  /** The line above the name. */
  readonly eyebrow: string;
  /** The differentiator: the largest text after the name, and the summary. */
  readonly statement: string;
  /** Scope and domains: the résumé summary's second sentence. */
  readonly statementSecondary: string;
  readonly availability: string;
  /** Page order. Every section appears exactly once. */
  readonly sections: readonly SectionId[];
  /** Section headings that differ from the default wording. */
  readonly titles?: Partial<Record<SectionId, string>>;
  /** The themes this voice was written to answer, strongest first. */
  readonly basedOn: readonly string[];
};

const DEFAULT_ORDER: readonly SectionId[] = [
  'work',
  'projects',
  'agentic',
  'proof',
  'about',
  'contact',
];

export const VOICES: Readonly<Record<ArchetypeId, Voice>> = {
  'tech-company-senior-developer': {
    eyebrow: '// senior software engineer',
    statement:
      'I build reliable software with AI coding agents, and the automated checks that keep it correct.',
    statementSecondary:
      'Senior engineer in health and education software. Previously technical lead on a university transfer-credit platform.',
    availability: 'Open to senior and staff roles',
    sections: DEFAULT_ORDER,
    basedOn: [
      'architecture',
      'ownership',
      'performance-scale',
      'product-sense',
    ],
  },
  'tech-company-staff-engineer': {
    eyebrow: '// senior engineer · technical lead',
    statement:
      'I set technical direction, then build the automated checks that let a team and its AI coding agents ship without breaking it.',
    statementSecondary:
      'Senior engineer and former technical lead in health and education software, where a wrong answer is expensive and quiet.',
    availability: 'Open to conversations about staff roles',
    sections: ['work', 'agentic', 'projects', 'proof', 'about', 'contact'],
    titles: { agentic: 'How I lead engineering' },
    basedOn: ['architecture', 'leadership', 'ownership', 'product-sense'],
  },
  'startup-small-company-senior-developer': {
    eyebrow: '> product engineer, idea to production',
    statement:
      'I take a product from an empty repository to production on my own, and ship fast because the checks are automatic.',
    statementSecondary:
      'Full-stack senior engineer who has shipped health and education products end to end, plus open-source tools and the platform they run on.',
    availability: 'Open to founding and early-stage engineering roles',
    sections: ['projects', 'work', 'agentic', 'proof', 'about', 'contact'],
    titles: { projects: 'Shipped on my own', agentic: 'How I ship fast' },
    basedOn: ['ownership', 'speed', 'data', 'open-source'],
  },
  'corporate-large-company-senior-developer': {
    eyebrow: 'Senior Software Engineer',
    statement:
      'I deliver well-tested software for regulated industries, integrated cleanly with the systems an organization already runs.',
    statementSecondary:
      'Senior full-stack engineer with enterprise experience in higher education and health: single sign-on, payments, data synchronization and release pipelines.',
    availability: 'Open to senior software engineering roles',
    sections: ['work', 'proof', 'projects', 'agentic', 'about', 'contact'],
    titles: {
      work: 'Professional experience',
      proof: 'Quality, measured',
      agentic: 'Engineering practices',
    },
    basedOn: [
      'testing-quality',
      'integrations',
      'ci-cd',
      'process',
      'regulated',
    ],
  },
  'corporate-contractor-systems-architect': {
    eyebrow: 'Systems architecture and delivery',
    statement:
      'I design and deliver systems for organizations modernizing what they already run: integrations, migrations, and the checks that keep them safe to change.',
    statementSecondary:
      'Senior engineer and former technical lead on client platforms in higher education and health, from scoping through launch and handoff.',
    availability: 'Available for contract and consulting engagements',
    sections: ['work', 'projects', 'agentic', 'proof', 'about', 'contact'],
    titles: {
      work: 'Engagements',
      projects: 'Systems designed and built',
      agentic: 'How I deliver',
    },
    basedOn: ['integrations', 'architecture', 'stakeholders', 'leadership'],
  },
};
