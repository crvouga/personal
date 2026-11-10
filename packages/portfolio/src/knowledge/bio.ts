/**
 * Chris in his own words, one entry per paragraph, in the `text.ts` markup.
 * `{location}` is filled from `identity.ts`, so the city is typed once.
 */
const BAND_URL = 'https://www.instagram.com/tripolartheband/';

export const BIO: readonly string[] = [
  "I'm based in {location}. My work has been in education and health software: university platforms for transfer credit, admissions and coursework, and tools that help people act on their lab results. In both, being wrong is expensive and quiet, which is why I build the checks first.",
  `A degree in mathematics and statistics keeps me honest on the data-heavy parts. Away from the keyboard I play drums in a [band](${BAND_URL}).`,
];
