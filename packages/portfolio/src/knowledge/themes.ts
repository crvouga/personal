/**
 * Themes: the kinds of evidence a fact can be, in an employer's vocabulary.
 *
 * This is the join key between the two halves of the system. Market research
 * measures how often job postings ask for each theme
 * (`scripts/market/taxonomy.ts`); every fact in the knowledge base is tagged
 * with the themes it is evidence of. A presentation is then a ranking: the
 * facts that prove what a given kind of employer asks for most come first.
 */
export const THEMES = {
  'ai-assisted': 'AI-assisted engineering',
  'ai-products': 'Building AI and LLM features',
  'testing-quality': 'Automated testing and quality',
  'ci-cd': 'CI/CD and release automation',
  architecture: 'System design and architecture',
  leadership: 'Technical leadership and mentoring',
  ownership: 'End-to-end ownership',
  'product-sense': 'Product sense and cross-functional work',
  integrations: 'APIs and third-party integrations',
  'cloud-infra': 'Cloud and infrastructure',
  data: 'Data modelling and pipelines',
  regulated: 'Regulated domains and compliance',
  process: 'Agile delivery process',
  stakeholders: 'Clients and stakeholders',
  documentation: 'Specs and written communication',
  'performance-scale': 'Performance, scale and reliability',
  mobile: 'Mobile',
  'frontend-craft': 'Interface craft and accessibility',
  payments: 'Payments and billing',
  realtime: 'Real-time and offline sync',
  modernization: 'Legacy modernization and migration',
  speed: 'Shipping speed',
  'open-source': 'Open source',
} as const;

export type Theme = keyof typeof THEMES;

export const THEME_IDS = Object.keys(THEMES) as Theme[];
