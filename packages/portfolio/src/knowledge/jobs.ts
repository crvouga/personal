/**
 * Employment history. Each achievement is one checkable sentence: senior-role
 * bullets carry a number or link the named artifact (`copy.test.ts`).
 *
 * Unanswered facts (months, metrics, the gap between roles) are tracked in
 * CONTENT_QUESTIONS.md and left unset here rather than guessed.
 */
import type { Job } from './types';

const GEVITI_APP_URL = 'https://app.gogeviti.com/';
const GEVITI_SITE_URL = 'https://www.gogeviti.com/';
const TRIANGULATOR_DEMO_URL = 'https://www.youtube.com/watch?v=yQCrMBHQrDM';

export const JOBS: readonly Job[] = [
  {
    id: 'geviti',
    employer: 'Geviti',
    employerUrl: GEVITI_SITE_URL,
    title: 'Senior Software Engineer',
    start: { year: 2026, month: 1 },
    end: 'Present',
    topics: ['typescript', 'react', 'react-native', 'postgres', 'bun', 'aws'],
    achievements: [
      {
        id: 'geviti-member-features',
        text: `Shipped member-facing features on web and mobile for the [Geviti member app](${GEVITI_APP_URL}): lab results, personalized protocols, prescriptions, and care-team coordination.`,
        themes: ['product-sense', 'mobile', 'regulated', 'frontend-craft'],
        topics: ['typescript', 'react', 'react-native'],
      },
      {
        id: 'geviti-lab-to-protocol',
        text: `Built the path from a member's lab results to their [personalized protocol](${GEVITI_SITE_URL}): metrics they track over time, tied to the therapies their care team prescribes.`,
        themes: ['data', 'ownership', 'regulated', 'product-sense'],
        topics: ['typescript', 'postgres', 'aws'],
      },
    ],
  },
  {
    id: 'one-origin',
    employer: 'One Origin',
    employerUrl: 'https://oneorigin.us/',
    title: 'Senior Software Engineer',
    start: { year: 2022 },
    end: { year: 2025 },
    awards: [
      'Four quarterly recognition awards: 2024 Q1, 2024 Q2, 2024 Q3–Q4 (one award for both quarters), and 2025 Q1',
    ],
    achievements: [
      {
        id: 'triangulator-tech-lead',
        text: `Technical lead on [**Triangulator**](${TRIANGULATOR_DEMO_URL}), which automates university transfer-credit evaluation: staff approve, adjust, or reject ranked suggestions instead of reviewing each course by hand.`,
        themes: [
          'leadership',
          'architecture',
          'stakeholders',
          'data',
          'regulated',
        ],
        topics: ['python', 'vue', 'graphql', 'postgres', 'aws'],
      },
      {
        id: 'orchard-lms-integration',
        text: "Designed and built the learning-management-system integration for [**Orchard**](https://asuorchard.asu.edu/), ASU's assignment platform: single sign-on and grade sync, including recovery when a grade fails to post.",
        themes: [
          'integrations',
          'architecture',
          'performance-scale',
          'regulated',
        ],
        topics: ['php', 'mysql', 'javascript'],
      },
      {
        id: 'earned-admissions-backend',
        text: 'Reworked the backend of [**ASU Earned Admissions**](https://ea.asu.edu/), where learners earn credit toward admission, and built its enrollment data sync and program opt-in flow.',
        themes: ['modernization', 'data', 'integrations', 'regulated'],
        topics: ['nodejs', 'typescript', 'dynamodb', 'aws', 'salesforce'],
      },
      {
        id: 'study-hall-payments',
        text: 'Rebuilt payment processing for [**Study Hall**](https://gostudyhall.com/), the learning platform ASU runs with Crash Course, cutting failed payments and making the flow safe to change.',
        themes: [
          'payments',
          'modernization',
          'testing-quality',
          'performance-scale',
        ],
        topics: ['nodejs', 'vue', 'aws', 'dynamodb'],
      },
      {
        id: 'sun-devils-features',
        text: "Built the interactive schedule and news features of [**Sun Devils**](https://sundevils.com/), ASU's athletics site.",
        themes: ['frontend-craft', 'product-sense'],
        topics: ['react', 'javascript', 'php'],
      },
    ],
  },
  {
    id: 'freelancing',
    employer: 'Freelancing',
    title: 'Software Engineer',
    start: { year: 2020 },
    end: { year: 2022 },
    achievements: [
      {
        id: 'freelance-delivery',
        text: 'Delivered custom websites and web applications for small businesses, from scoping through launch and handoff.',
        themes: ['stakeholders', 'ownership', 'product-sense'],
        topics: [],
      },
      {
        id: 'freelance-client-relationship',
        text: 'Owned the client relationship alongside the code: requirements, timelines, and post-launch support.',
        themes: ['stakeholders', 'ownership', 'documentation'],
        topics: [],
      },
    ],
  },
];

/**
 * One honest line about the time between the last two roles. Unset until
 * Chris supplies it (CONTENT_QUESTIONS.md); nothing is said that is not true.
 */
export const JOB_GAP_NOTE: string | undefined = undefined;
