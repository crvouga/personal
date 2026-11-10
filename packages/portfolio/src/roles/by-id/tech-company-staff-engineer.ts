import { defineRole } from '../define';

// Most distinctive ask: technical leadership, far above the market; then
// architecture (nearly every posting) and AI-assisted engineering.
export default defineRole({
  id: 'tech-company-staff-engineer',
  label: 'Staff',
  audience: 'Staff, principal and lead hiring at software product companies',
  description:
    'Staff, principal and lead roles at the same software companies. The asks shift from building to direction: architecture, technical leadership, mentoring and working with stakeholders. Postings ask for more years than any other segment, so this is the stretch target.',
  cells: [{ context: 'tech', levels: ['staff'] }],
  voice: {
    eyebrow: '// technical lead · architecture',
    headline: 'Senior Software Engineer · Technical Lead',
    // RoleResearch: position as a senior working at staff scope; never claim the title.
    statement:
      'I set technical direction, record it as durable decisions, and enforce it with checks a whole team and its AI coding agents ship behind.',
    statementSecondary:
      'Technical lead on a university transfer-credit platform, from architecture to adoption, and senior engineer in health and education software, where a wrong answer is expensive and quiet.',
    availability: 'Open to staff and principal engineering roles',
    sections: ['work', 'agentic', 'proof', 'projects', 'about', 'contact'],
    titles: {
      work: 'Scope and technical direction',
      agentic: 'Engineering standards, enforced',
      proof: 'Reliability, verified',
      projects: 'Systems and decisions',
    },
    basedOn: [
      'leadership',
      'architecture',
      'product-sense',
      'ownership',
      'ai-assisted',
    ],
  },
});
