/**
 * Early and small projects: games, toys, and client sites from before the work
 * the homepage leads with.
 *
 * They are kept out of `PROJECTS` so they never dilute the curated listing, the
 * Toolbox stack, the screenshot jobs, or the resume — but they stay in the
 * repository and render behind the "show everything" fold on `/projects/`, so
 * every project ever built is still one page away.
 */
import type { Project } from './types';
import { toYouTubeVideoUrl } from './shared';

export const PROJECT_ENTRIES_ARCHIVE: readonly Project[] = [
  {
    id: 'todo-app',
    title: 'Fullstack Todo App',
    setting: 'side',
    deployment: { t: 'public', url: 'https://todo.chrisvouga.dev' },
    code: { t: 'public', url: 'https://github.com/crvouga/todo-v1' },
    description: 'A task manager with user accounts and real-time sync.',
    imageAlt: 'Fullstack Todo App screenshot',
    imageSrc: [
      '/fullstack-todo-app-screenshot.optimized.webp',
      '/todo.optimized.webp',
    ],
    galleryImageSrc: [
      '/fullstack-todo-app-screenshot.optimized.webp',
      '/todo.optimized.webp',
    ],
    topics: [
      'typescript',
      'vue',
      'css',
      'express',
      'javascript',
      'tailwind',
      'nodejs',
      'mongodb',
    ],
  },
  {
    id: 'connect-four',
    title: 'Connect Four: AI & Multiplayer',
    setting: 'side',
    deployment: { t: 'public', url: 'https://connectfour.chrisvouga.dev/' },
    code: { t: 'public', url: 'https://github.com/crvouga/connect-four' },
    description:
      'Connect Four with online multiplayer and a computer opponent.',
    imageAlt: 'Connect Four: AI & Multiplayer screenshot',
    imageSrc: [
      '/connect-four-ai-multiplayer-screenshot.optimized.webp',
      '/connect-four.optimized.webp',
    ],
    galleryImageSrc: [
      '/connect-four-ai-multiplayer-screenshot.optimized.webp',
      toYouTubeVideoUrl({
        youTubeVideoId: '9_TbyftkaQw',
        autoplay: true,
        mute: true,
      }),
      '/connect-four.optimized.webp',
    ],
    topics: [
      'css',
      'greensock',
      'heroku',
      'material-ui',
      'nodejs',
      'ramda',
      'redux',
      'redux-saga',
      'javascript',
      'socket-io',
    ],
  },
  {
    id: 'quiz-maker',
    title: 'LTI compatible quiz maker',
    setting: 'side',
    deployment: { t: 'not-deployed-anymore' },
    code: { t: 'public', url: 'https://github.com/crvouga/quiz-maker' },
    description:
      'A quiz builder that plugs into learning management systems, so instructors and students never leave their course.',
    imageAlt: 'LTI compatible quiz maker screenshot',
    imageSrc: [],
    galleryImageSrc: [],
    topics: ['css', 'express', 'nodejs', 'tailwind', 'typescript', 'vue'],
  },
  {
    id: 'courier-website',
    title: 'Courier Company Website',
    setting: 'work',
    deployment: {
      t: 'public',
      url: 'https://gps-couriers-website.vercel.app/',
    },
    code: { t: 'private' },
    description: 'Marketing website for a healthcare courier company.',
    imageAlt: 'Courier Company Website screenshot',
    imageSrc: [
      '/courier-company-website-screenshot.optimized.webp',
      '/courier.optimized.webp',
    ],
    galleryImageSrc: [
      '/courier-company-website-screenshot.optimized.webp',
      toYouTubeVideoUrl({
        youTubeVideoId: 'kFwPTJcM6I0',
        autoplay: true,
        mute: true,
      }),
      '/courier.optimized.webp',
    ],
    topics: ['css', 'material-ui', 'nextjs', 'react', 'typescript'],
    resume: { include: false },
  },
  {
    id: 'anime-blog',
    title: 'Anime Blog',
    setting: 'side',
    deployment: { t: 'public', url: 'https://anime.chrisvouga.dev/' },
    code: { t: 'public', url: 'https://github.com/crvouga/anime' },
    description:
      'A blog built as a fast static site, with content managed separately from the code.',
    imageAlt: 'Anime Blog screenshot',
    imageSrc: [
      '/anime-blog-screenshot.optimized.webp',
      '/anime.optimized.webp',
    ],
    galleryImageSrc: [
      '/anime-blog-screenshot.optimized.webp',
      '/anime.optimized.webp',
    ],
    topics: [
      'css',
      'javascript',
      'sanity',
      'vue',
      'bootstrap',
      'graphql',
      'gridsome',
    ],
  },
  {
    id: 'snake-game',
    title: 'Smooth Snake Game',
    setting: 'side',
    deployment: { t: 'public', url: 'https://snake.chrisvouga.dev/' },
    code: { t: 'public', url: 'https://github.com/crvouga/snake' },
    description:
      'The classic Snake game, with smooth animation and responsive controls.',
    imageAlt: 'Smooth Snake Game screenshot',
    imageSrc: [
      '/smooth-snake-game-screenshot.optimized.webp',
      '/snake.optimized.webp',
    ],
    galleryImageSrc: [
      '/smooth-snake-game-screenshot.optimized.webp',
      toYouTubeVideoUrl({
        youTubeVideoId: '7El3RdkzlHs',
        autoplay: true,
        mute: true,
      }),
      '/snake.optimized.webp',
    ],
    topics: ['css', 'javascript', 'ramda', 'react'],
  },
  {
    id: 'match-three',
    title: 'Match Three',
    setting: 'side',
    deployment: { t: 'public', url: 'https://matchthree.chrisvouga.dev/' },
    code: { t: 'public', url: 'https://github.com/crvouga/match-three' },
    description: 'A match-three puzzle game in the spirit of Candy Crush.',
    imageAlt: 'Match Three screenshot',
    imageSrc: ['/match-three-screenshot.optimized.webp'],
    galleryImageSrc: [
      '/match-three-screenshot.optimized.webp',
      toYouTubeVideoUrl({
        youTubeVideoId: 'VBrlDgmXSoA',
        autoplay: true,
        mute: true,
      }),
    ],
    topics: ['css', 'javascript', 'ramda', 'react', 'redux', 'redux-saga'],
  },
  {
    id: 'simon-says',
    title: 'Simon Says',
    setting: 'side',
    deployment: { t: 'public', url: 'https://simonsays.chrisvouga.dev/' },
    code: { t: 'public', url: 'https://github.com/crvouga/simon-says' },
    description:
      'The classic Simon Says memory game, with sound, visuals, and rising difficulty.',
    imageAlt: 'Simon Says screenshot',
    imageSrc: ['/simon-says-screenshot.optimized.webp'],
    galleryImageSrc: [
      '/simon-says-screenshot.optimized.webp',
      toYouTubeVideoUrl({
        youTubeVideoId: 'WrUFzlKL0E0',
        autoplay: true,
        mute: true,
      }),
    ],
    topics: ['css', 'javascript', 'ramda', 'react', 'redux', 'redux-saga'],
  },
  {
    id: 'cheese',
    title: 'Cheese',
    setting: 'side',
    deployment: { t: 'not-deployed-anymore' },
    code: { t: 'public', url: 'https://github.com/crvouga/cheese' },
    description:
      'Generates customizable event ID cards, with all image editing done in the browser.',
    imageAlt: 'Cheese screenshot',
    imageSrc: ['/cheese.optimized.webp'],
    galleryImageSrc: [
      toYouTubeVideoUrl({
        youTubeVideoId: 'hv3tRBHF7w4',
        autoplay: true,
        mute: true,
      }),
      '/cheese.optimized.webp',
    ],
    topics: ['css', 'typescript', 'material-ui', 'react', 'firebase'],
  },
  {
    id: 'airr',
    title: 'Airr Product Demo',
    setting: 'work',
    deployment: { t: 'not-deployed-anymore' },
    code: { t: 'private' },
    description:
      'Interactive product demo for Airr, an enterprise tool that automates transcript intake and analysis.',
    imageAlt: 'Airr product demo: transcript intake screen',
    imageSrc: [
      '/airr-product-demo-screenshot.optimized.webp',
      '/airr/1.optimized.webp',
      '/airr/2.optimized.webp',
      '/airr/3.optimized.webp',
      '/airr/4.optimized.webp',
      '/airr/5.optimized.webp',
      '/airr/6.optimized.webp',
    ],
    galleryImageSrc: [
      '/airr-product-demo-screenshot.optimized.webp',
      '/airr/1.optimized.webp',
      '/airr/2.optimized.webp',
      '/airr/3.optimized.webp',
      '/airr/4.optimized.webp',
      '/airr/5.optimized.webp',
      '/airr/6.optimized.webp',
      '/airr/7.optimized.webp',
    ],
    topics: [
      'typescript',
      'nodejs',
      'postgres',
      'react',
      'tailwind',
      'trpc',
      'vercel',
    ],
    resume: { include: false },
  },
  {
    id: 'pickflix',
    title: 'Pickflix',
    setting: 'side',
    deployment: { t: 'public', url: 'https://pickflix.chrisvouga.dev' },
    code: { t: 'public', url: 'https://github.com/crvouga/pickflix-v1' },
    description:
      'A social movie-discovery app for watching trailers, writing reviews, and building shared lists with friends.',
    imageAlt: 'Pickflix movie page with trailers and reviews',
    imageSrc: ['/pickflix-screenshot.optimized.webp'],
    galleryImageSrc: [
      '/pickflix-screenshot.optimized.webp',
      toYouTubeVideoUrl({
        youTubeVideoId: '-atthbuMFIM',
        autoplay: true,
        mute: true,
      }),
    ],
    topics: [
      'express',
      'jest',
      'material-ui',
      'nodejs',
      'postgres',
      'ramda',
      'react',
      'redux',
      'redux-saga',
      'typescript',
      'css',
      'react-query',
    ],
  },
];
