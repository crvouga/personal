import { defineRole } from '../define';

// The role family with the best fit in the sample and pay above the senior
// median: engineers who build product features on top of model APIs. Its
// research puts shipped model features, evaluations and cost awareness first,
// which the knowledge base backs only in part (see /gaps/).
export default defineRole({
  id: 'ai-product-engineer',
  label: 'AI',
  audience: 'Teams hiring engineers to build AI features into their product',
  description:
    'Applied AI, AI product and full-stack AI engineering roles across every kind of employer: building product features on top of model APIs, not training models. Postings ask for shipped AI features, measured quality and cost, and the full-stack product work around the model. The best-fitting family in the sample, and paid above the senior median.',
  cells: [{ family: 'ai-product', levels: ['mid', 'senior', 'staff'] }],
  voice: {
    eyebrow: '// product engineer · AI features',
    headline: 'Senior Full-Stack Engineer · AI Products',
    statement:
      'I build the product around the model: routing across model providers with per-request cost tracking, and the full-stack features around it.',
    statementSecondary:
      'Full-stack senior engineer on health and education products, who builds every day with AI coding agents under written rules and required checks.',
    availability: 'Open to AI product engineering roles',
    // RoleResearch: lead with the model-facing system, then how the work is verified.
    sections: ['projects', 'agentic', 'work', 'proof', 'about', 'contact'],
    titles: {
      projects: 'Built around the model',
      agentic: 'How I build with AI coding agents',
      proof: 'Measured, not claimed',
    },
    resumeTitles: { projects: 'AI and Product Work' },
    basedOn: [
      'ai-products',
      'ownership',
      'ai-assisted',
      'architecture',
      'integrations',
    ],
  },
  style: {
    // The research's look is the senior presentation's (blue, sans, mono labels);
    // a violet accent keeps the two apart within the same calm, cool range.
    hue: 295,
  },
});
