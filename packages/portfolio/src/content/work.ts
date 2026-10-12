export type Work = {
  name: string;
  infoUrl?: string;
  jobTitle: string;
  /** Scannable bullets; the site cards and the resume both render these. */
  highlights: string[];
  yearStart: number;
  yearEnd: number | 'Present';
  /**
   * Optional month (1-12) for date precision. Year-only ranges read as an
   * evasion tell to recruiters; fill these in when the exact months are known.
   */
  monthStart?: number;
  monthEnd?: number;
  /**
   * Recognition rendered as text. Award images alone are invisible to crawlers,
   * to LLM candidate research, and to anyone who does not open a gallery.
   */
  awards?: string[];
  imageSrc: string[];
  imageAlt: string;
  galleryImageSrc: string[];
};

export const WORK: Work[] = [
  {
    name: 'Geviti',
    infoUrl: 'https://www.gogeviti.com/',
    jobTitle: 'Senior Software Engineer',
    highlights: [
      'Build member-facing features across web and mobile for a health and longevity platform: lab results, personalized protocols, prescriptions, and care-team coordination.',
      'Work with member health data and prescription workflows, where correctness and auditability matter more than raw speed.',
      'Turn lab results into metrics members can track and act on over time.',
    ],
    yearStart: 2026,
    yearEnd: 'Present',
    imageSrc: ['/geviti-screenshot.optimized.webp'],
    imageAlt: 'Geviti website screenshot',
    galleryImageSrc: ['/geviti-screenshot.optimized.webp'],
  },
  {
    name: 'One Origin',
    infoUrl: 'https://oneorigin.us/',
    jobTitle: 'Senior Software Engineer',
    highlights: [
      'Technical lead on <strong>Triangulator</strong>, an enterprise platform that automates how universities evaluate transfer credit, replacing manual review with ranked suggestions that staff approve, adjust, or reject with a reason.',
      "Designed and built the learning-management-system integration for <strong>Orchard</strong>, ASU's customizable-assignment platform: single sign-on and automatic grade sync, including the failure paths for when a grade does not post.",
      'Reworked the backend of <strong>ASU Earned Admissions</strong>, where learners earn credit toward admission to ASU degree programs, and built its enrollment data sync and a new program opt-in flow.',
      "Rebuilt payment processing for <strong>Study Hall</strong>, the learning platform ASU runs with the Study Hall YouTube channel, cutting failed payments and making the flow safe to change. Also built interactive features for <strong>Sun Devils</strong>, ASU's athletics site.",
    ],
    yearStart: 2022,
    yearEnd: 2025,
    awards: [
      'Quarterly recognition award — 2024 Q1, 2024 Q2, 2024 Q3–Q4, and 2025 Q1',
    ],
    imageSrc: [
      '/one-origin-screenshot.optimized.webp',
      '/one-origin/2025-q1-award-1.optimized.webp',
    ],
    imageAlt: 'One Origin website screenshot and award certificates',
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
    yearStart: 2020,
    yearEnd: 2022,
    imageSrc: [],
    imageAlt: '',
    galleryImageSrc: [],
  },
];
