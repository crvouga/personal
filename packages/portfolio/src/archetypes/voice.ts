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

export const VOICES: Readonly<Record<ArchetypeId, Voice>> = {
  // Postings: ownership, reliability, architecture and product sense, each
  // asked for by two-thirds or more; the knowledge base fits them well.
  'tech-company-senior-developer': {
    eyebrow: '// senior software engineer',
    statement:
      'I own product features end to end, from design to reliable production, and build with AI coding agents behind the automated checks that keep them correct.',
    statementSecondary:
      'Senior full-stack engineer on member-facing health and education products. Previously technical lead on a university transfer-credit platform.',
    availability: 'Open to senior product engineering roles',
    sections: ['work', 'projects', 'proof', 'agentic', 'about', 'contact'],
    titles: { proof: 'Reliability, verified' },
    basedOn: [
      'ownership',
      'performance-scale',
      'architecture',
      'product-sense',
      'testing-quality',
    ],
  },
  // Most distinctive ask: technical leadership, far above the market; then
  // architecture (nearly every posting) and AI-assisted engineering.
  'tech-company-staff-engineer': {
    eyebrow: '// technical lead · architecture',
    statement:
      'I set technical direction and make it enforceable: the architecture, and the automated checks that let a team and its AI coding agents ship safely.',
    statementSecondary:
      'Former technical lead on a university transfer-credit platform, and senior engineer in health and education software, where a wrong answer is expensive and quiet.',
    availability: 'Open to staff and principal engineering roles',
    sections: ['work', 'agentic', 'proof', 'projects', 'about', 'contact'],
    titles: {
      work: 'Scope and leadership',
      agentic: 'How I lead engineering',
      proof: 'Standards, enforced',
    },
    basedOn: [
      'leadership',
      'architecture',
      'ai-assisted',
      'product-sense',
      'performance-scale',
    ],
  },
  // Ownership first; data, open source and speed are what set these postings
  // apart from the rest of the market.
  'startup-small-company-senior-developer': {
    eyebrow: '> product engineer, idea to production',
    statement:
      'I take a product from an empty repository to production on my own (data model, cloud, interface) and ship fast because the checks are automatic.',
    statementSecondary:
      'Full-stack senior engineer who has shipped health and education products end to end, plus open-source tools and the platform they run on.',
    availability: 'Open to founding and early-stage engineering roles',
    sections: ['projects', 'work', 'agentic', 'proof', 'about', 'contact'],
    titles: {
      projects: 'Shipped on my own',
      agentic: 'How I ship fast',
      proof: 'Built in the open',
    },
    basedOn: ['ownership', 'speed', 'data', 'open-source', 'cloud-infra'],
  },
  // Process, testing and release automation are asked for two to three times
  // as often as elsewhere; integrations by four postings in five.
  'corporate-large-company-senior-developer': {
    eyebrow: 'Senior Software Engineer',
    statement:
      'I deliver well-tested software that integrates cleanly with the systems an organization already runs, through release pipelines that catch problems first.',
    statementSecondary:
      'Senior full-stack engineer with enterprise experience in higher education and health: single sign-on, payments, data synchronization and automated release pipelines.',
    availability: 'Open to senior software engineering roles',
    sections: ['work', 'proof', 'projects', 'agentic', 'about', 'contact'],
    titles: {
      work: 'Professional experience',
      proof: 'Testing and quality, measured',
      agentic: 'Engineering and delivery practices',
    },
    basedOn: [
      'testing-quality',
      'ci-cd',
      'integrations',
      'process',
      'architecture',
    ],
  },
  // Integrations, cloud, release automation and stakeholders all run well
  // above the market here: the client is buying delivered systems.
  'corporate-contractor-systems-architect': {
    eyebrow: 'Systems architecture and delivery',
    statement:
      'I design and deliver integrations, cloud infrastructure and release pipelines for organizations modernizing what they run, from scoping through handoff.',
    statementSecondary:
      'Senior engineer and former technical lead on client platforms in higher education and health, who has owned requirements, timelines and post-launch support.',
    availability: 'Available for contract and consulting engagements',
    sections: ['work', 'projects', 'agentic', 'proof', 'about', 'contact'],
    titles: {
      work: 'Engagements',
      projects: 'Systems designed and delivered',
      agentic: 'How I deliver',
      proof: 'Delivery quality, verified',
    },
    basedOn: [
      'integrations',
      'cloud-infra',
      'ci-cd',
      'stakeholders',
      'architecture',
    ],
  },
};
