import { defineRole } from '../define';

// Ownership first; data, open source and speed are what set these postings
// apart from the rest of the market.
export default defineRole({
  id: 'startup-small-company-senior-developer',
  label: 'Startup',
  audience: 'Founders and first engineers hiring at small companies',
  description:
    'Engineers hired directly by founders at small companies, including founding-engineer roles. Titles are loose and the stack is narrow; what is asked for is someone who owns a product end to end and ships quickly. The segment the knowledge base fits best.',
  cells: [{ context: 'startup', levels: ['mid', 'senior', 'staff'] }],
  // Research: founders scan a grid of things built and shipped.
  showcase: { count: 6, lead: false },
  voice: {
    eyebrow: '> product engineer · idea to production',
    headline: 'Senior Full-Stack Product Engineer',
    statement:
      'I build products end to end and ship them: data model, cloud and interface, live in production, kept fast and safe by AI coding agents and automated checks.',
    statementSecondary:
      'Full-stack senior engineer who has shipped health and education products, open-source developer tools, and the platform they run on.',
    availability: 'Open to founding and early-stage product engineering roles',
    // RoleResearch: founders ask what you built before where you worked.
    sections: ['projects', 'work', 'agentic', 'proof', 'about', 'contact'],
    titles: {
      projects: 'Built and shipped',
      work: 'Where I have shipped',
      agentic: 'How I ship fast',
      proof: 'Built in the open',
    },
    basedOn: ['ownership', 'data', 'open-source', 'speed', 'performance-scale'],
  },
});
