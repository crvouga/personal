/**
 * Early and small work (games, toys, client sites). Kept out of
 * `PROJECT_FACTS` so it never dilutes a ranked listing or a résumé;
 * `/projects/` shows it behind a fold so nothing built is lost.
 */
import type { ProjectFact } from './types';

export const ARCHIVE_PROJECT_FACTS: readonly ProjectFact[] = [
  {
    id: 'todo-app',
    title: 'Fullstack Todo App',
    setting: 'side',
    deployment: {
      t: 'public',
      url: 'https://todo.chrisvouga.dev',
    },
    code: {
      t: 'public',
      url: 'https://github.com/crvouga/todo-v1',
    },
    description: 'A task manager with user accounts and real-time sync.',
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
    themes: [],
  },
  {
    id: 'connect-four',
    title: 'Connect Four: AI & Multiplayer',
    setting: 'side',
    deployment: {
      t: 'public',
      url: 'https://connectfour.chrisvouga.dev/',
    },
    code: {
      t: 'public',
      url: 'https://github.com/crvouga/connect-four',
    },
    description:
      'Connect Four with online multiplayer and a computer opponent.',
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
    themes: [],
  },
  {
    id: 'quiz-maker',
    title: 'LTI compatible quiz maker',
    setting: 'side',
    deployment: {
      t: 'not-deployed-anymore',
    },
    code: {
      t: 'public',
      url: 'https://github.com/crvouga/quiz-maker',
    },
    description:
      'A quiz builder that plugs into learning management systems, so instructors and students never leave their course.',
    topics: ['css', 'express', 'nodejs', 'tailwind', 'typescript', 'vue'],
    themes: [],
  },
  {
    id: 'courier-website',
    title: 'Courier Company Website',
    setting: 'work',
    deployment: {
      t: 'public',
      url: 'https://gps-couriers-website.vercel.app/',
    },
    code: {
      t: 'private',
    },
    description: 'Marketing website for a healthcare courier company.',
    topics: ['css', 'material-ui', 'nextjs', 'react', 'typescript'],
    themes: [],
  },
  {
    id: 'anime-blog',
    title: 'Anime Blog',
    setting: 'side',
    deployment: {
      t: 'public',
      url: 'https://anime.chrisvouga.dev/',
    },
    code: {
      t: 'public',
      url: 'https://github.com/crvouga/anime',
    },
    description:
      'A blog built as a fast static site, with content managed separately from the code.',
    topics: [
      'css',
      'javascript',
      'sanity',
      'vue',
      'bootstrap',
      'graphql',
      'gridsome',
    ],
    themes: [],
  },
  {
    id: 'snake-game',
    title: 'Smooth Snake Game',
    setting: 'side',
    deployment: {
      t: 'public',
      url: 'https://snake.chrisvouga.dev/',
    },
    code: {
      t: 'public',
      url: 'https://github.com/crvouga/snake',
    },
    description:
      'The classic Snake game, with smooth animation and responsive controls.',
    topics: ['css', 'javascript', 'ramda', 'react'],
    themes: [],
  },
  {
    id: 'match-three',
    title: 'Match Three',
    setting: 'side',
    deployment: {
      t: 'public',
      url: 'https://matchthree.chrisvouga.dev/',
    },
    code: {
      t: 'public',
      url: 'https://github.com/crvouga/match-three',
    },
    description: 'A match-three puzzle game in the spirit of Candy Crush.',
    topics: ['css', 'javascript', 'ramda', 'react', 'redux', 'redux-saga'],
    themes: [],
  },
  {
    id: 'simon-says',
    title: 'Simon Says',
    setting: 'side',
    deployment: {
      t: 'public',
      url: 'https://simonsays.chrisvouga.dev/',
    },
    code: {
      t: 'public',
      url: 'https://github.com/crvouga/simon-says',
    },
    description:
      'The classic Simon Says memory game, with sound, visuals, and rising difficulty.',
    topics: ['css', 'javascript', 'ramda', 'react', 'redux', 'redux-saga'],
    themes: [],
  },
  {
    id: 'cheese',
    title: 'Cheese',
    setting: 'side',
    deployment: {
      t: 'not-deployed-anymore',
    },
    code: {
      t: 'public',
      url: 'https://github.com/crvouga/cheese',
    },
    description:
      'Generates customizable event ID cards, with all image editing done in the browser.',
    topics: ['css', 'typescript', 'material-ui', 'react', 'firebase'],
    themes: [],
  },
  {
    id: 'airr',
    title: 'Airr Product Demo',
    setting: 'work',
    deployment: {
      t: 'not-deployed-anymore',
    },
    code: {
      t: 'private',
    },
    description:
      'Interactive product demo for Airr, an enterprise tool that automates transcript intake and analysis.',
    topics: [
      'typescript',
      'nodejs',
      'postgres',
      'react',
      'tailwind',
      'trpc',
      'vercel',
    ],
    themes: [],
  },
  {
    id: 'pickflix',
    title: 'Pickflix',
    setting: 'side',
    deployment: {
      t: 'public',
      url: 'https://pickflix.chrisvouga.dev',
    },
    code: {
      t: 'public',
      url: 'https://github.com/crvouga/pickflix-v1',
    },
    description:
      'A social movie-discovery app for watching trailers, writing reviews, and building shared lists with friends.',
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
    themes: [],
  },
];
