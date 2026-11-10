import { defineRole } from '../define';

// Postings: ownership, reliability, architecture and product sense, each
// asked for by two-thirds or more; the knowledge base fits them well.
export default defineRole({
  id: 'tech-company-senior-developer',
  label: 'Senior',
  audience: 'Senior engineer hiring at software product companies',
  description:
    'Senior individual-contributor roles at companies whose product is software, from scale-ups to big tech. The largest segment in the sample and the level currently held, so it is the default. These postings ask for ownership of a feature area, sound system design and reliable delivery alongside product and design.',
  cells: [{ context: 'tech', levels: ['mid', 'senior'] }],
  voice: {
    eyebrow: '// senior product engineer',
    headline: 'Senior Software Engineer · Full-Stack Product',
    statement:
      'I own product features end to end, from design doc to reliable production, and ship with AI coding agents behind automated tests and human review.',
    statementSecondary:
      'Senior full-stack engineer on member-facing health and education products; previously technical lead on a university transfer-credit platform, from design through rollout.',
    availability: 'Open to senior product engineering roles',
    // RoleResearch: lead with one owned product, then how AI-assisted work is verified.
    sections: ['work', 'agentic', 'projects', 'proof', 'about', 'contact'],
    titles: {
      work: 'Shipped and owned',
      agentic: 'How I ship with AI coding agents',
      proof: 'Reliability, verified',
    },
    basedOn: [
      'ownership',
      'performance-scale',
      'product-sense',
      'architecture',
      'ai-assisted',
    ],
  },
});
