/**
 * Projects: what was built, where it runs, what it is made of, and what it is
 * evidence of. Order is the curated priority, used to break ranking ties.
 *
 * Runtime hosting for side projects lives in
 * packages/infra/tofu/modules/inventory/inventory.tf.json. A project's
 * screenshots are presentation: `src/content/projects/media.ts`.
 */
import type { ProjectFact } from './types';

export const PROJECT_FACTS: readonly ProjectFact[] = [
  {
    id: 'mockingbird',
    title: 'Mockingbird',
    setting: 'side',
    deployment: {
      t: 'public',
      url: 'https://mockingbird.chrisvouga.dev/',
    },
    code: {
      t: 'public',
      url: 'https://github.com/crvouga/mockingbird',
    },
    description:
      'Realistic stand-ins for third-party services, so software can be tested end to end without calling the real thing.',
    topics: ['typescript', 'bun', 'nodejs', 'sqlite'],
    themes: [
      'testing-quality',
      'integrations',
      'open-source',
      'ai-assisted',
      'documentation',
    ],
  },
  {
    id: 'gamezilla',
    title: 'gamezilla.app',
    setting: 'side',
    deployment: {
      t: 'public',
      url: 'https://www.gamezilla.app/',
    },
    code: {
      t: 'private',
    },
    description:
      'A local-first multiplayer game platform for phones: a live space keeps working offline, then catches up on its own when the connection returns.',
    topics: [
      'typescript',
      'react',
      'postgres',
      'tailwind',
      'websocket',
      'bun',
      'sqlite',
    ],
    themes: [
      'realtime',
      'mobile',
      'architecture',
      'product-sense',
      'ownership',
    ],
  },
  {
    id: 'workspace-platform',
    title: 'Workspace platform',
    setting: 'side',
    deployment: {
      t: 'private',
    },
    code: {
      t: 'public',
      url: 'https://github.com/crvouga/workspace',
    },
    description:
      'The monorepo and self-hosted platform behind this site and my side projects, where declared code is the only way to change infrastructure.',
    topics: [
      'typescript',
      'opentofu',
      'nixos',
      'github-actions',
      'docker',
      'bun',
      'cloudflare',
      'railway',
      'postgres',
      'openbao',
      'playwright',
      'astro',
    ],
    themes: [
      'cloud-infra',
      'ci-cd',
      'architecture',
      'ai-assisted',
      'testing-quality',
    ],
  },
  {
    id: 'geviti-app',
    title: 'Geviti member app',
    setting: 'work',
    deployment: {
      t: 'public',
      url: 'https://app.gogeviti.com/',
    },
    code: {
      t: 'private',
    },
    description:
      'Health and longevity platform that turns lab results into personalized protocols, therapies, and coordinated care. I build its member-facing features.',
    topics: ['typescript', 'react', 'react-native', 'postgres', 'bun', 'aws'],
    themes: ['product-sense', 'mobile', 'regulated'],
  },
  {
    id: 'triangulator',
    title: 'Triangulator',
    setting: 'work',
    deployment: {
      t: 'private',
    },
    code: {
      t: 'private',
    },
    description:
      'Enterprise platform that automates how universities evaluate transfer credit. I was the technical lead.',
    topics: [
      'typescript',
      'vue',
      'tailwind',
      'nuxt',
      'postgres',
      'python',
      'graphql',
      'aws',
      'graphene',
      'flask',
      'neo4j',
      's3',
    ],
    themes: ['leadership', 'architecture', 'stakeholders', 'data', 'regulated'],
  },
  {
    id: 'headless-combobox',
    title: 'headless-combobox',
    setting: 'side',
    deployment: {
      t: 'public',
      url: 'https://headlesscombobox.chrisvouga.dev',
    },
    code: {
      t: 'public',
      url: 'https://github.com/crvouga/headless-combobox',
    },
    description:
      'An accessible autocomplete component that works with any interface framework, published as an open-source library.',
    topics: ['typescript'],
    themes: ['frontend-craft', 'open-source', 'documentation'],
  },
  {
    id: 'study-hall',
    title: 'Study Hall',
    setting: 'work',
    deployment: {
      t: 'public',
      url: 'https://gostudyhall.com/',
    },
    code: {
      t: 'private',
    },
    description:
      'Online learning platform from ASU and Crash Course. I rebuilt its payment processing to cut failed payments.',
    topics: [
      'javascript',
      'vue',
      'nuxt',
      'bootstrap',
      'aws',
      'dynamodb',
      'salesforce',
      'express',
      'nodejs',
    ],
    themes: ['payments', 'modernization', 'regulated'],
  },
  {
    id: 'orchard',
    title: 'Orchard',
    setting: 'work',
    deployment: {
      t: 'public',
      url: 'https://asuorchard.asu.edu/',
    },
    code: {
      t: 'private',
    },
    description:
      "ASU platform for building highly customizable assignments. I designed and built its integration with the university's learning management system.",
    topics: ['php', 'mysql', 'drupal', 'bootstrap', 'javascript'],
    themes: ['integrations', 'regulated'],
  },
  {
    id: 'normalizer-app',
    title: 'normalizer.app',
    setting: 'side',
    deployment: {
      t: 'not-deployed-anymore',
    },
    code: {
      t: 'public',
      url: 'https://github.com/crvouga/normalizer.app.git',
    },
    description:
      'Automates the tedious work of reshaping spreadsheet data from one format into another.',
    topics: [
      'typescript',
      'react',
      'tailwind',
      'bun',
      'postgres',
      's3',
      'trpc',
      'zod',
    ],
    themes: ['data', 'product-sense', 'ownership'],
  },
  {
    id: 'image-service',
    title: 'Image service',
    setting: 'side',
    deployment: {
      t: 'public',
      url: 'https://imageservice.chrisvouga.dev',
    },
    code: {
      t: 'public',
      url: 'https://github.com/crvouga/imageresizerservice.com',
    },
    description:
      'A self-hosted service that resizes and optimizes images on demand, with no configuration required.',
    topics: ['go'],
    themes: ['performance-scale', 'cloud-infra', 'ownership'],
  },
  {
    id: 'screenshot-service',
    title: 'Screenshots as a Service',
    setting: 'side',
    deployment: {
      t: 'not-deployed-anymore',
    },
    code: {
      t: 'public',
      url: 'https://github.com/crvouga/screenshot-service',
    },
    description:
      'A service for capturing screenshots of web pages programmatically.',
    topics: [
      'css',
      'heroku',
      'material-ui',
      'nodejs',
      'postgres',
      'puppeteer',
      'react',
      'react-query',
      'typescript',
      'supabase',
    ],
    themes: ['integrations', 'cloud-infra'],
  },
  {
    id: 'moviefinder-app',
    title: 'moviefinder.app',
    setting: 'side',
    deployment: {
      t: 'public',
      url: 'https://moviefinder-app-rust.chrisvouga.dev',
    },
    code: {
      t: 'public',
      url: 'https://github.com/crvouga/moviefinder.app-rust',
    },
    description:
      'One movie-discovery app rebuilt on several technology stacks, holding the product constant to compare their real trade-offs.',
    topics: ['rust', 'go', 'typescript', 'react', 'clojurescript'],
    themes: ['architecture', 'product-sense'],
  },
  {
    id: 'asu-earned-admissions',
    title: 'ASU Earned Admissions',
    setting: 'work',
    deployment: {
      t: 'public',
      url: 'https://ea.asu.edu/',
    },
    code: {
      t: 'private',
    },
    description:
      'Platform where learners earn college credit toward admission to ASU degree programs. I reworked its backend and its enrollment data sync.',
    topics: [
      'salesforce',
      'nodejs',
      'typescript',
      'express',
      'dynamodb',
      'aws',
    ],
    themes: ['modernization', 'data', 'integrations', 'regulated'],
  },
  {
    id: 'sun-devils',
    title: 'Sun Devils',
    setting: 'work',
    deployment: {
      t: 'public',
      url: 'https://sundevils.com/',
    },
    code: {
      t: 'private',
    },
    description:
      "Official site of ASU's Sun Devils athletics. I built its interactive schedule and news features.",
    topics: ['bootstrap', 'drupal', 'javascript', 'react', 'css', 'php'],
    themes: ['frontend-craft', 'product-sense'],
  },
  {
    id: 'violets-garden',
    title: "Violet's Garden",
    setting: 'side',
    deployment: {
      t: 'public',
      url: 'https://violetsgarden.chrisvouga.dev',
    },
    code: {
      t: 'public',
      url: 'https://github.com/crvouga/violets-garden',
    },
    description:
      'A cozy puzzle game about guiding a pug through garden mazes, with every level automatically proven solvable.',
    topics: ['typescript', 'phaser', 'tone-js', 'javascript', 'html', 'docker'],
    themes: ['testing-quality', 'frontend-craft'],
  },
  {
    id: 'llm-proxy',
    title: 'LLM Proxy',
    setting: 'side',
    deployment: {
      t: 'public',
      url: 'https://llm-proxy.chrisvouga.dev',
    },
    code: {
      t: 'public',
      url: 'https://github.com/crvouga/llm-server',
    },
    description:
      'A self-hosted gateway that routes AI model requests to any provider and records usage for cost and health visibility.',
    topics: [
      'typescript',
      'react',
      'tailwind',
      'bun',
      'postgres',
      'docker',
      'nodejs',
    ],
    themes: ['ai-products', 'integrations', 'cloud-infra'],
  },
];
