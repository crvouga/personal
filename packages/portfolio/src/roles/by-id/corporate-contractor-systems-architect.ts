import { defineRole } from '../define';

// Integrations, cloud, release automation and stakeholders all run well
// above the market here: the client is buying delivered systems.
export default defineRole({
  id: 'corporate-contractor-systems-architect',
  label: 'Contractor',
  audience:
    'Consultancies and enterprises hiring contract leads and architects',
  description:
    'Contract engagements and consultancies, plus lead and architect roles inside large enterprises. The work is designing and delivering systems for a client: integrations, cloud, modernization, and time spent with stakeholders.',
  cells: [
    { context: 'contract', levels: ['mid', 'senior', 'staff'] },
    { context: 'corporate', levels: ['staff'] },
  ],
  voice: {
    eyebrow: 'Systems integration · cloud delivery',
    headline: 'Senior Software Engineer · Technical Lead',
    statement:
      'I design and deliver integrations, cloud infrastructure and release pipelines for organizations modernizing what they run, from requirements to handoff.',
    statementSecondary:
      'Senior engineer and former technical lead on client platforms in higher education and health: single sign-on, CRM and learning-system integrations, payments, and infrastructure as code.',
    availability: 'Available for contract and consulting engagements, remote',
    sections: ['work', 'projects', 'agentic', 'proof', 'about', 'contact'],
    titles: {
      work: 'Engagements and past performance',
      projects: 'Systems designed and delivered',
      agentic: 'Delivery approach',
      proof: 'Delivery quality, verified',
    },
    resumeTitles: {
      experience: 'Professional Experience',
      skills: 'Technical Skills',
    },
    basedOn: [
      'integrations',
      'cloud-infra',
      'architecture',
      'leadership',
      'stakeholders',
    ],
  },
  style: {
    // The research asks for the corporate presentation's restrained navy; a deep
    // green keeps the same restraint and tells the two documents apart.
    hue: 165,
  },
});
