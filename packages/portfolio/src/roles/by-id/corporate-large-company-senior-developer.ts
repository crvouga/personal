import { defineRole } from '../define';

// Process, testing and release automation are asked for two to three times
// as often as elsewhere; integrations by four postings in five.
export default defineRole({
  id: 'corporate-large-company-senior-developer',
  label: 'Corporate',
  audience: 'Engineering managers and recruiters at large enterprises',
  description:
    'Software engineers at large enterprises whose product is not software: banks, insurers, health systems and retailers. These postings are process-heavy and name testing, release pipelines, integrations and regulated domains far more often than the rest of the market.',
  cells: [{ context: 'corporate', levels: ['mid', 'senior'] }],
  voice: {
    eyebrow: 'Senior Software Engineer',
    // RoleResearch: the exact posted title, which screening systems match on.
    headline: 'Senior Software Engineer',
    statement:
      'I build and integrate secure web applications for regulated institutions through a disciplined lifecycle: code review, automated testing and release pipelines.',
    statementSecondary:
      'Senior software engineer with enterprise experience in higher education and healthcare: single sign-on, learning-system and CRM data synchronization, payment processing and production support.',
    availability: 'Open to senior software engineering roles',
    sections: ['work', 'proof', 'projects', 'agentic', 'about', 'contact'],
    titles: {
      work: 'Professional experience',
      proof: 'Testing and quality, measured',
      agentic: 'Delivery practices and controls',
    },
    resumeTitles: {
      experience: 'Professional Experience',
      skills: 'Technical Skills',
    },
    basedOn: [
      'testing-quality',
      'ci-cd',
      'integrations',
      'architecture',
      'regulated',
    ],
  },
});
