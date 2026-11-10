/**
 * Who Chris is and how to reach him. Declared once; every surface derives
 * from it, so a change of level or city is a one-line edit.
 */
export const IDENTITY = {
  name: 'Chris Vouga',
  /** The level currently held. */
  title: 'Senior Software Engineer',
  location: { city: 'Phoenix', region: 'AZ', countryCode: 'US' },
  email: 'crvouga@gmail.com',
  phone: '4802098698',
  siteUrl: 'https://www.chrisvouga.dev',
  siteSourceUrl:
    'https://github.com/crvouga/workspace/tree/main/packages/portfolio',
  profiles: {
    github: 'https://github.com/crvouga',
    linkedin: 'https://www.linkedin.com/in/chris-vouga',
    x: 'https://x.com/ChristopherVou7',
  },
} as const;

/**
 * The first filters a recruiter applies. Only what is known is stated; an
 * unset field is an open question in CONTENT_QUESTIONS.md, never a guess.
 */
export type Logistics = {
  readonly authorization?: string;
  readonly timeZone?: string;
  readonly start?: string;
  readonly replyTime?: string;
};

export const LOGISTICS: Logistics = {
  authorization: 'US citizen · no sponsorship needed',
  // Arizona does not observe daylight saving time, so this is true all year.
  timeZone: 'UTC−7 (Arizona, no daylight saving)',
};

/** Where Chris will work from. */
export const WORK_PREFERENCE = 'open to remote';
