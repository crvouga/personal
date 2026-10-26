import { a } from './a';
import type { Topic } from './topic';

/**
 * A role boundary. `month` (1–12) is optional because a guessed month is worse
 * than a visible year: an unanswered one renders as the year alone and is
 * tracked in CONTENT_QUESTIONS.md, never smoothed over.
 */
export type YearMonth = { readonly year: number; readonly month?: number };

export type Work = {
  name: string;
  infoUrl?: string;
  jobTitle: string;
  /**
   * Scannable bullets; the site cards and the resume both render these.
   * Senior roles: each one carries a number or a link to the named artifact
   * (`src/content/copy.test.ts`), because a bullet a reviewer cannot check is a
   * bullet they skip.
   */
  highlights: string[];
  start: YearMonth;
  end: YearMonth | 'Present';
  /**
   * Recognition rendered as text. Award images alone are invisible to crawlers,
   * to LLM candidate research, and to anyone who does not open a gallery.
   */
  awards?: string[];
  /**
   * The role's stack, for the Toolbox and the résumé's Skills. Client work is
   * also told through PROJECTS, whose topics count too; this is for a role
   * whose product is not a portfolio project.
   */
  topics?: Topic[];
  imageSrc: string[];
  imageAlt: string;
  galleryImageSrc: string[];
};

const GEVITI_APP_URL = 'https://app.gogeviti.com/';
const GEVITI_SITE_URL = 'https://www.gogeviti.com/';
const TRIANGULATOR_DEMO_URL = 'https://www.youtube.com/watch?v=yQCrMBHQrDM';

export const WORK: Work[] = [
  {
    name: 'Geviti',
    infoUrl: GEVITI_SITE_URL,
    jobTitle: 'Senior Software Engineer',
    highlights: [
      `Shipped member-facing features on web and mobile for the ${a(GEVITI_APP_URL, 'Geviti member app')}: lab results, personalized protocols, prescriptions, and care-team coordination.`,
      `Built the path from a member's lab results to their ${a(GEVITI_SITE_URL, 'personalized protocol')}: metrics they track over time, tied to the therapies their care team prescribes.`,
    ],
    start: { year: 2026, month: 1 },
    end: 'Present',
    topics: ['typescript', 'react', 'react-native', 'postgres', 'bun', 'aws'],
    // No gallery: the only image was Geviti's marketing homepage, which shows
    // none of my work and would read as if it did.
    imageSrc: [],
    imageAlt: '',
    galleryImageSrc: [],
  },
  {
    name: 'One Origin',
    infoUrl: 'https://oneorigin.us/',
    jobTitle: 'Senior Software Engineer',
    highlights: [
      `Technical lead on ${a(TRIANGULATOR_DEMO_URL, '<strong>Triangulator</strong>')}, which automates university transfer-credit evaluation: staff approve, adjust, or reject ranked suggestions instead of reviewing each course by hand.`,
      `Designed and built the learning-management-system integration for ${a('https://asuorchard.asu.edu/', '<strong>Orchard</strong>')}, ASU's assignment platform: single sign-on and grade sync, including recovery when a grade fails to post.`,
      `Reworked the backend of ${a('https://ea.asu.edu/', '<strong>ASU Earned Admissions</strong>')}, where learners earn credit toward admission, and built its enrollment data sync and program opt-in flow.`,
      `Rebuilt payment processing for ${a('https://gostudyhall.com/', '<strong>Study Hall</strong>')}, the learning platform ASU runs with Crash Course, cutting failed payments and making the flow safe to change.`,
      `Built the interactive schedule and news features of ${a('https://sundevils.com/', '<strong>Sun Devils</strong>')}, ASU's athletics site.`,
    ],
    start: { year: 2022 },
    end: { year: 2025 },
    awards: [
      'Four quarterly recognition awards: 2024 Q1, 2024 Q2, 2024 Q3–Q4 (one award for both quarters), and 2025 Q1',
    ],
    imageSrc: [
      '/one-origin-screenshot.optimized.webp',
      '/one-origin/2025-q1-award-1.optimized.webp',
    ],
    imageAlt: 'One Origin website and quarterly recognition award certificates',
    galleryImageSrc: [
      '/one-origin-screenshot.optimized.webp',
      '/one-origin/2025-q1-award-1.optimized.webp',
      '/one-origin/2024-q3-&-q4-award-1.optimized.webp',
      '/one-origin/2024-q2-award-1.optimized.webp',
      '/one-origin/2024-q1-award-1.optimized.webp',
      '/one-origin/desk.optimized.webp',
    ],
  },
  {
    name: 'Freelancing',
    jobTitle: 'Software Engineer',
    highlights: [
      'Delivered custom websites and web applications for small businesses, from scoping through launch and handoff.',
      'Owned the client relationship alongside the code: requirements, timelines, and post-launch support.',
    ],
    start: { year: 2020 },
    end: { year: 2022 },
    imageSrc: [],
    imageAlt: '',
    galleryImageSrc: [],
  },
];

/**
 * One honest line about the time between the last two roles, rendered between
 * them. Unset until Chris supplies it (CONTENT_QUESTIONS.md): the dates stay
 * visible either way, and nothing is said that is not true.
 */
export const WORK_GAP_NOTE: string | undefined = undefined;

/** The role the hero and résumé headline describe. */
export const CURRENT_WORK: Work | undefined = WORK.find(
  (job) => job.end === 'Present'
);
