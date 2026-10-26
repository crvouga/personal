// Order-preserving split of PROJECTS (max-lines); append new projects here.
// Part 2 is the archive tail: real work and real tools, but not the entries a
// reviewer should hit first.
import type { Project } from './types';
import { toYouTubeVideoUrl } from './shared';

export const PROJECT_ENTRIES_PART_2: readonly Project[] = [
  {
    id: 'normalizer-app',
    title: 'normalizer.app',
    setting: 'side',
    deployment: { t: 'not-deployed-anymore' },
    code: { t: 'public', url: 'https://github.com/crvouga/normalizer.app.git' },
    description:
      'Automates the tedious work of reshaping spreadsheet data from one format into another.',
    imageAlt:
      'normalizer.app new-session screen: pick a target format and upload a spreadsheet',
    imageSrc: ['/normalizer-app-screenshot.optimized.webp'],
    galleryImageSrc: [
      '/normalizer-app-screenshot.optimized.webp',
      toYouTubeVideoUrl({
        youTubeVideoId: 'xUtdHEUeUzs',
        autoplay: true,
        mute: true,
      }),
    ],
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
  },
  {
    id: 'image-service',
    title: 'Image service',
    setting: 'side',
    deployment: { t: 'public', url: 'https://imageservice.chrisvouga.dev' },
    code: {
      t: 'public',
      url: 'https://github.com/crvouga/imageresizerservice.com',
    },
    description:
      'A self-hosted service that resizes and optimizes images on demand, with no configuration required.',
    imageAlt: 'Image service sign-in screen: request a login link by email',
    imageSrc: ['/image-service-screenshot.optimized.webp'],
    galleryImageSrc: ['/image-service-screenshot.optimized.webp'],
    topics: ['go'],
  },
  {
    id: 'screenshot-service',
    title: 'Screenshots as a Service',
    setting: 'side',
    deployment: { t: 'not-deployed-anymore' },
    code: { t: 'public', url: 'https://github.com/crvouga/screenshot-service' },
    description:
      'A service for capturing screenshots of web pages programmatically.',
    imageAlt: 'Screenshots as a Service sign-in screen',
    imageSrc: [
      '/screenshots-as-a-service-screenshot.optimized.webp',
      '/screenshot-service.optimized.webp',
    ],
    galleryImageSrc: [
      '/screenshots-as-a-service-screenshot.optimized.webp',
      toYouTubeVideoUrl({
        youTubeVideoId: 'lCEzYGJ0rN8',
        autoplay: true,
        mute: true,
      }),
      '/screenshot-service.optimized.webp',
    ],
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
    imageAlt:
      'moviefinder.app feed in a phone-width layout, showing a movie poster',
    imageSrc: ['/moviefinder-app-rust-screenshot.optimized.webp'],
    galleryImageSrc: [
      '/moviefinder-app-rust-screenshot.optimized.webp',
      '/moviefinder-app-go-screenshot.optimized.webp',
      '/moviefinder-app-react-screenshot.optimized.webp',
      '/moviefinder-app-clojurescript-screenshot.optimized.webp',
    ],
    topics: ['rust', 'go', 'typescript', 'react', 'clojurescript'],
  },
  {
    id: 'asu-earned-admissions',
    title: 'ASU Earned Admissions',
    setting: 'work',
    deployment: { t: 'public', url: 'https://ea.asu.edu/' },
    code: { t: 'private' },
    description:
      'Platform where learners earn college credit toward admission to ASU degree programs. I reworked its backend and its enrollment data sync.',
    imageAlt: 'ASU Earned Admission homepage: earn your ASU degree, your way',
    imageSrc: ['/asu-earned-admission-screenshot.optimized.webp'],
    galleryImageSrc: ['/asu-earned-admission-screenshot.optimized.webp'],
    topics: [
      'salesforce',
      'nodejs',
      'typescript',
      'express',
      'dynamodb',
      'aws',
    ],
    resume: { include: false },
  },
  {
    id: 'sun-devils',
    title: 'Sun Devils',
    setting: 'work',
    deployment: { t: 'public', url: 'https://sundevils.com/' },
    code: { t: 'private' },
    description:
      "Official site of ASU's Sun Devils athletics. I built its interactive schedule and news features.",
    imageAlt:
      'Sun Devil Athletics homepage: a football score banner and upcoming games',
    imageSrc: ['/sun-devils-screenshot.optimized.webp'],
    galleryImageSrc: [
      '/sun-devils-screenshot.optimized.webp',
      '/sun-devils/2.optimized.webp',
      '/sun-devils/3.optimized.webp',
      '/sun-devils/4.optimized.webp',
      '/sun-devils/5.optimized.webp',
    ],
    topics: ['bootstrap', 'drupal', 'javascript', 'react', 'css', 'php'],
  },
  {
    id: 'violets-garden',
    title: "Violet's Garden",
    setting: 'side',
    deployment: { t: 'public', url: 'https://violetsgarden.chrisvouga.dev' },
    code: { t: 'public', url: 'https://github.com/crvouga/violets-garden' },
    description:
      'A cozy puzzle game about guiding a pug through garden mazes, with every level automatically proven solvable.',
    imageAlt:
      "Violet's Garden title screen: a pug beside Play, Level select and How to play",
    imageSrc: ['/violets-garden-screenshot.optimized.webp'],
    galleryImageSrc: ['/violets-garden-screenshot.optimized.webp'],
    topics: ['typescript', 'phaser', 'tone-js', 'javascript', 'html', 'docker'],
    resume: { include: false },
  },
  {
    id: 'llm-proxy',
    title: 'LLM Proxy',
    setting: 'side',
    deployment: { t: 'public', url: 'https://llm-proxy.chrisvouga.dev' },
    code: { t: 'public', url: 'https://github.com/crvouga/llm-server' },
    description:
      'A self-hosted gateway that routes AI model requests to any provider and records usage for cost and health visibility.',
    imageAlt:
      'LLM Proxy dashboard: backend address and upstream header settings',
    imageSrc: ['/llm-proxy-screenshot.optimized.webp'],
    galleryImageSrc: [
      '/llm-proxy-screenshot.optimized.webp',
      toYouTubeVideoUrl({
        youTubeVideoId: 'Zsrk8x2X2uc',
        autoplay: true,
        mute: true,
      }),
    ],
    topics: [
      'typescript',
      'react',
      'tailwind',
      'bun',
      'postgres',
      'docker',
      'nodejs',
    ],
  },
];
