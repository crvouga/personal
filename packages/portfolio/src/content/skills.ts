/**
 * Topic → skill-category mapping shared by the site Toolbox and the resume
 * generator, so both artifacts describe the same stack.
 */
import { TOPIC_TO_NAME, type Topic } from './topic';

export type SkillRow = {
  readonly category: string;
  readonly items: readonly string[];
};

type Category = 'Languages' | 'Frontend' | 'Backend' | 'Data' | 'Infra & CI';

const TOPIC_CATEGORY: Partial<Record<Topic, Category>> = {
  // Languages
  typescript: 'Languages',
  javascript: 'Languages',
  python: 'Languages',
  rust: 'Languages',
  go: 'Languages',
  php: 'Languages',
  html: 'Languages',
  css: 'Languages',
  elm: 'Languages',
  roc: 'Languages',
  // Frontend
  react: 'Frontend',
  'react-native': 'Frontend',
  nextjs: 'Frontend',
  vue: 'Frontend',
  nuxt: 'Frontend',
  tailwind: 'Frontend',
  redux: 'Frontend',
  'redux-saga': 'Frontend',
  'react-query': 'Frontend',
  'material-ui': 'Frontend',
  bootstrap: 'Frontend',
  greensock: 'Frontend',
  rxjs: 'Frontend',
  alphinejs: 'Frontend',
  htmx: 'Frontend',
  datastar: 'Frontend',
  gridsome: 'Frontend',
  // Backend
  nodejs: 'Backend',
  bun: 'Backend',
  express: 'Backend',
  flask: 'Backend',
  graphene: 'Backend',
  graphql: 'Backend',
  trpc: 'Backend',
  websocket: 'Backend',
  'socket-io': 'Backend',
  zod: 'Backend',
  // Data
  postgres: 'Data',
  mongodb: 'Data',
  mysql: 'Data',
  dynamodb: 'Data',
  sqlite: 'Data',
  firebase: 'Data',
  supabase: 'Data',
  neo4j: 'Data',
  astro: 'Frontend',
  // Infra & CI
  aws: 'Infra & CI',
  s3: 'Infra & CI',
  vercel: 'Infra & CI',
  heroku: 'Infra & CI',
  docker: 'Infra & CI',
  opentofu: 'Infra & CI',
  nixos: 'Infra & CI',
  'github-actions': 'Infra & CI',
  cloudflare: 'Infra & CI',
  railway: 'Infra & CI',
  openbao: 'Infra & CI',
  playwright: 'Infra & CI',
  // Skipped on purpose: shopify, sanity, drupal, salesforce, jest, puppeteer, ramda
};

const CATEGORY_ORDER: readonly string[] = [
  'Languages',
  'Frontend',
  'Backend',
  'Data',
  'Infra & CI',
];

export const AI_ROW_CATEGORY = 'AI-assisted engineering';

/**
 * Pinned first on the Toolbox and the résumé. Methods, plus only the agent
 * tools the commit history shows in daily use (co-author trailers counted in
 * platform-facts.json): no tool is named that is not evidenced.
 */
export const AI_ASSISTED_ROW: SkillRow = {
  category: AI_ROW_CATEGORY,
  items: [
    'Claude Code',
    'Cursor',
    'spec-driven development',
    'CI-gated agent workflows',
    'property-based testing',
  ],
};

/** Buckets topic keys into display-ready category rows, in {@link CATEGORY_ORDER}. */
export function buildSkillRows(topics: readonly string[]): SkillRow[] {
  const buckets = new Map<string, Set<string>>();
  for (const topic of topics) {
    const cat = TOPIC_CATEGORY[topic as Topic];
    if (!cat) continue;
    const display = TOPIC_TO_NAME[topic as Topic] ?? topic;
    if (!buckets.has(cat)) buckets.set(cat, new Set());
    buckets.get(cat)?.add(display);
  }
  const rows: SkillRow[] = [];
  for (const cat of CATEGORY_ORDER) {
    const set = buckets.get(cat);
    if (!set || set.size === 0) continue;
    rows.push({
      category: cat,
      items: [...set].sort((a, b) => a.localeCompare(b)),
    });
  }
  return rows;
}
