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
  `I'm a full-stack software engineer based in ${LOCATION}. I take features from idea to production and stay responsible for them once they are live.`,
  `My work has been in education technology and health software: university platforms for transfer credit, admissions, and coursework, and tools that help people act on their health data. Both are domains where being wrong is expensive and quiet, which shapes how I build.`,
  `I work spec-first. Before anything is built I write down what correct looks like, then turn it into automated checks that run on every change. That is what lets me hand real work to AI coding agents and still vouch for the result.`,
  `A background in mathematics and statistics keeps me honest on the data-heavy parts.`,
  `Away from the keyboard I play drums in a ${BAND_A_TAG}.`,
];

export const ABOUT_YOUTUBE_VIDEO_ID = '7rHHSdnvX94';
export const ABOUT_YOUTUBE_EMBED_URL = `https://www.youtube.com/embed/${ABOUT_YOUTUBE_VIDEO_ID}?modestbranding=1&rel=0&playsinline=1&iv_load_policy=3`;
export const ABOUT_YOUTUBE_VIDEO_TITLE = 'Cursor AI gift video';
export const ABOUT_GITHUB_HEATMAP_TEXT =
  'GitHub contribution heatmap. Each square is a day; darker is more.';
