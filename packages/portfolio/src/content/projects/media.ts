/**
 * The site's media for each project in the knowledge base, keyed by project
 * id: cover, gallery (images and YouTube embeds) and résumé curation.
 */
import type { ProjectMedia } from './types';

export const PROJECT_MEDIA: Readonly<Record<string, ProjectMedia>> = {
  mockingbird: {
    imageSrc: ['/mockingbird-screenshot.optimized.webp'],
    imageAlt:
      'Mockingbird documentation site: an install command and a request to the Stripe emulator',
    galleryImageSrc: ['/mockingbird-screenshot.optimized.webp'],
  },
  gamezilla: {
    imageSrc: [
      '/gamezilla.optimized.webp',
      '/gamezilla-app-screenshot.optimized.webp',
    ],
    imageAlt:
      'gamezilla in two phone-sized windows: one live chess game seen from each player’s side',
    galleryImageSrc: [
      '/gamezilla.optimized.webp',
      'https://www.youtube.com/embed/VSLpdPvHbD4?autoplay=1&mute=1&loop=1&playlist=VSLpdPvHbD4',
      '/gamezilla-app-screenshot.optimized.webp',
    ],
  },
  'workspace-platform': {
    imageSrc: ['/workspace-platform-diagram.svg'],
    imageAlt:
      'Workspace platform architecture: the repository and its CI gates, declared infrastructure, the hosted services, and the daily health loop',
    galleryImageSrc: [],
  },
  'geviti-app': {
    imageSrc: ['/geviti-app-screenshot.optimized.webp'],
    imageAlt:
      'Geviti member app sign-in: the complete picture of your health, from bloodwork, genetics and gut health',
    galleryImageSrc: ['/geviti-app-screenshot.optimized.webp'],
  },
  triangulator: {
    imageSrc: ['/triangulator.optimized.webp'],
    imageAlt:
      'Triangulator suggestion details: a community-college course matched to an Arizona State University course, with its review history',
    galleryImageSrc: [
      'https://www.youtube.com/embed/yQCrMBHQrDM?autoplay=1&mute=1&loop=1&playlist=yQCrMBHQrDM',
      '/triangulator/assigned-reject-reason.optimized.webp',
      '/triangulator/course-search-details-2.optimized.webp',
      '/triangulator/course-search-loading.optimized.webp',
      '/triangulator/course-search.optimized.webp',
      '/triangulator/find-course.optimized.webp',
      '/triangulator/inst-admin-all-users.optimized.webp',
      '/triangulator/inst-admin-assign.optimized.webp',
      '/triangulator/inst-admin-boost-suggestions.optimized.webp',
      '/triangulator/inst-admin-dashboard.optimized.webp',
      '/triangulator/inst-admin-download.optimized.webp',
      '/triangulator/inst-admin-new-suggestions.optimized.webp',
      '/triangulator/inst-admin-public-profile.optimized.webp',
      '/triangulator/inst-admin-summary.optimized.webp',
      '/triangulator/inst-admin-upload-choice.optimized.webp',
      '/triangulator/inst-admin-upload-course.optimized.webp',
      '/triangulator/inst-public-profile.optimized.webp',
      '/triangulator/new-suggestions-assign.optimized.webp',
      '/triangulator/public-search-filter.optimized.webp',
      '/triangulator/search-results.optimized.webp',
      '/triangulator/suggestion-details-reject-reason.optimized.webp',
      '/triangulator/suggestion-details.optimized.webp',
      '/triangulator/tri-admin-dashboard.optimized.webp',
      '/triangulator/tri-admin-new-suggestions.optimized.webp',
      '/triangulator/tri-admin-suggestion-details.optimized.webp',
      '/triangulator/tri-admin-summary.optimized.webp',
    ],
  },
  'headless-combobox': {
    imageSrc: ['/headless-combobox-screenshot.optimized.webp'],
    imageAlt:
      'headless-combobox documentation: the API reference beside a demo of a multi-select combobox',
    galleryImageSrc: ['/headless-combobox-screenshot.optimized.webp'],
  },
  'study-hall': {
    imageSrc: [
      '/study-hall-screenshot.optimized.webp',
      '/studyhall.optimized.webp',
    ],
    imageAlt:
      'Study Hall homepage: earn college credit with Crash Course and Arizona State University',
    galleryImageSrc: [
      '/study-hall-screenshot.optimized.webp',
      'https://www.youtube.com/embed/BC4K0u7Zm4k?autoplay=1&mute=1&loop=1&playlist=BC4K0u7Zm4k',
      '/studyhall/1.optimized.webp',
      '/studyhall/2.optimized.webp',
      '/studyhall/3.optimized.webp',
      '/studyhall/4.optimized.webp',
      '/studyhall/5.optimized.webp',
      '/studyhall/6.optimized.webp',
      '/studyhall/7.optimized.webp',
      '/studyhall/8.optimized.webp',
      '/studyhall/9.optimized.webp',
      '/studyhall/10.optimized.webp',
      '/studyhall/11.optimized.webp',
      '/studyhall/12.optimized.webp',
      '/studyhall/13.optimized.webp',
    ],
  },
  orchard: {
    imageSrc: ['/orchard.optimized.webp'],
    imageAlt:
      'Orchard assignment page: an embedded precalculus video with subject and attribution details',
    galleryImageSrc: ['/orchard.optimized.webp'],
    resume: {
      include: false,
    },
  },
  'normalizer-app': {
    imageSrc: ['/normalizer-app-screenshot.optimized.webp'],
    imageAlt:
      'normalizer.app new-session screen: pick a target format and upload a spreadsheet',
    galleryImageSrc: [
      '/normalizer-app-screenshot.optimized.webp',
      'https://www.youtube.com/embed/xUtdHEUeUzs?autoplay=1&mute=1&loop=1&playlist=xUtdHEUeUzs',
    ],
  },
  'image-service': {
    imageSrc: ['/image-service-screenshot.optimized.webp'],
    imageAlt: 'Image service sign-in screen: request a login link by email',
    galleryImageSrc: ['/image-service-screenshot.optimized.webp'],
  },
  'screenshot-service': {
    imageSrc: [
      '/screenshots-as-a-service-screenshot.optimized.webp',
      '/screenshot-service.optimized.webp',
    ],
    imageAlt: 'Screenshots as a Service sign-in screen',
    galleryImageSrc: [
      '/screenshots-as-a-service-screenshot.optimized.webp',
      'https://www.youtube.com/embed/lCEzYGJ0rN8?autoplay=1&mute=1&loop=1&playlist=lCEzYGJ0rN8',
      '/screenshot-service.optimized.webp',
    ],
  },
  'moviefinder-app': {
    imageSrc: ['/moviefinder-app-rust-screenshot.optimized.webp'],
    imageAlt:
      'moviefinder.app feed in a phone-width layout, showing a movie poster',
    galleryImageSrc: [
      '/moviefinder-app-rust-screenshot.optimized.webp',
      '/moviefinder-app-go-screenshot.optimized.webp',
      '/moviefinder-app-react-screenshot.optimized.webp',
      '/moviefinder-app-clojurescript-screenshot.optimized.webp',
    ],
  },
  'asu-earned-admissions': {
    imageSrc: ['/asu-earned-admission-screenshot.optimized.webp'],
    imageAlt: 'ASU Earned Admission homepage: earn your ASU degree, your way',
    galleryImageSrc: ['/asu-earned-admission-screenshot.optimized.webp'],
    resume: {
      include: false,
    },
  },
  'sun-devils': {
    imageSrc: ['/sun-devils-screenshot.optimized.webp'],
    imageAlt:
      'Sun Devil Athletics homepage: a football score banner and upcoming games',
    galleryImageSrc: [
      '/sun-devils-screenshot.optimized.webp',
      '/sun-devils/2.optimized.webp',
      '/sun-devils/3.optimized.webp',
      '/sun-devils/4.optimized.webp',
      '/sun-devils/5.optimized.webp',
    ],
  },
  'violets-garden': {
    imageSrc: ['/violets-garden-screenshot.optimized.webp'],
    imageAlt:
      "Violet's Garden title screen: a pug beside Play, Level select and How to play",
    galleryImageSrc: ['/violets-garden-screenshot.optimized.webp'],
    resume: {
      include: false,
    },
  },
  'llm-proxy': {
    imageSrc: ['/llm-proxy-screenshot.optimized.webp'],
    imageAlt:
      'LLM Proxy dashboard: backend address and upstream header settings',
    galleryImageSrc: [
      '/llm-proxy-screenshot.optimized.webp',
      'https://www.youtube.com/embed/Zsrk8x2X2uc?autoplay=1&mute=1&loop=1&playlist=Zsrk8x2X2uc',
    ],
  },
};
