import { a } from './a';
import { LOCATION } from './hero';

const BAND_HREF = 'https://www.instagram.com/tripolartheband/';
const BAND_A_TAG = a(BAND_HREF, 'band');

/**
 * One entry per paragraph, each trusted HTML. They are separate strings rather
 * than one newline-delimited block because the section renders a real `<p>` per
 * paragraph \u2014 a single block would need `white-space: pre-line`, which forces
 * any inline `<a>` onto its own line.
 */
export const ABOUT_ME_PARAGRAPHS: readonly string[] = [
  `I'm based in ${LOCATION}. My work has been in education and health software: university platforms for transfer credit, admissions and coursework, and tools that help people act on their lab results. In both, being wrong is expensive and quiet, which is why I build the checks first.`,
  `A degree in mathematics and statistics keeps me honest on the data-heavy parts. Away from the keyboard I play drums in a ${BAND_A_TAG}.`,
];
