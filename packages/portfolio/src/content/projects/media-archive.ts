/** Media for the archived projects, keyed by project id. */
import type { ProjectMedia } from './types';

export const ARCHIVE_PROJECT_MEDIA: Readonly<Record<string, ProjectMedia>> = {
  'todo-app': {
    imageSrc: [
      '/fullstack-todo-app-screenshot.optimized.webp',
      '/todo.optimized.webp',
    ],
    imageAlt: 'Fullstack Todo App screenshot',
    galleryImageSrc: [
      '/fullstack-todo-app-screenshot.optimized.webp',
      '/todo.optimized.webp',
    ],
  },
  'connect-four': {
    imageSrc: [
      '/connect-four-ai-multiplayer-screenshot.optimized.webp',
      '/connect-four.optimized.webp',
    ],
    imageAlt: 'Connect Four: AI & Multiplayer screenshot',
    galleryImageSrc: [
      '/connect-four-ai-multiplayer-screenshot.optimized.webp',
      'https://www.youtube.com/embed/9_TbyftkaQw?autoplay=1&mute=1&loop=1&playlist=9_TbyftkaQw',
      '/connect-four.optimized.webp',
    ],
  },
  'quiz-maker': {
    imageSrc: [],
    imageAlt: 'LTI compatible quiz maker screenshot',
    galleryImageSrc: [],
  },
  'courier-website': {
    imageSrc: [
      '/courier-company-website-screenshot.optimized.webp',
      '/courier.optimized.webp',
    ],
    imageAlt: 'Courier Company Website screenshot',
    galleryImageSrc: [
      '/courier-company-website-screenshot.optimized.webp',
      'https://www.youtube.com/embed/kFwPTJcM6I0?autoplay=1&mute=1&loop=1&playlist=kFwPTJcM6I0',
      '/courier.optimized.webp',
    ],
    resume: {
      include: false,
    },
  },
  'anime-blog': {
    imageSrc: [
      '/anime-blog-screenshot.optimized.webp',
      '/anime.optimized.webp',
    ],
    imageAlt: 'Anime Blog screenshot',
    galleryImageSrc: [
      '/anime-blog-screenshot.optimized.webp',
      '/anime.optimized.webp',
    ],
  },
  'snake-game': {
    imageSrc: [
      '/smooth-snake-game-screenshot.optimized.webp',
      '/snake.optimized.webp',
    ],
    imageAlt: 'Smooth Snake Game screenshot',
    galleryImageSrc: [
      '/smooth-snake-game-screenshot.optimized.webp',
      'https://www.youtube.com/embed/7El3RdkzlHs?autoplay=1&mute=1&loop=1&playlist=7El3RdkzlHs',
      '/snake.optimized.webp',
    ],
  },
  'match-three': {
    imageSrc: ['/match-three-screenshot.optimized.webp'],
    imageAlt: 'Match Three screenshot',
    galleryImageSrc: [
      '/match-three-screenshot.optimized.webp',
      'https://www.youtube.com/embed/VBrlDgmXSoA?autoplay=1&mute=1&loop=1&playlist=VBrlDgmXSoA',
    ],
  },
  'simon-says': {
    imageSrc: ['/simon-says-screenshot.optimized.webp'],
    imageAlt: 'Simon Says screenshot',
    galleryImageSrc: [
      '/simon-says-screenshot.optimized.webp',
      'https://www.youtube.com/embed/WrUFzlKL0E0?autoplay=1&mute=1&loop=1&playlist=WrUFzlKL0E0',
    ],
  },
  cheese: {
    imageSrc: ['/cheese.optimized.webp'],
    imageAlt: 'Cheese screenshot',
    galleryImageSrc: [
      'https://www.youtube.com/embed/hv3tRBHF7w4?autoplay=1&mute=1&loop=1&playlist=hv3tRBHF7w4',
      '/cheese.optimized.webp',
    ],
  },
  airr: {
    imageSrc: [
      '/airr-product-demo-screenshot.optimized.webp',
      '/airr/1.optimized.webp',
      '/airr/2.optimized.webp',
      '/airr/3.optimized.webp',
      '/airr/4.optimized.webp',
      '/airr/5.optimized.webp',
      '/airr/6.optimized.webp',
    ],
    imageAlt: 'Airr product demo: transcript intake screen',
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
    resume: {
      include: false,
    },
  },
  pickflix: {
    imageSrc: ['/pickflix-screenshot.optimized.webp'],
    imageAlt: 'Pickflix movie page with trailers and reviews',
    galleryImageSrc: [
      '/pickflix-screenshot.optimized.webp',
      'https://www.youtube.com/embed/-atthbuMFIM?autoplay=1&mute=1&loop=1&playlist=-atthbuMFIM',
    ],
  },
};
