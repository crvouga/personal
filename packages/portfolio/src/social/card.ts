/**
 * The share card: what LinkedIn, X, Slack and iMessage show when the site is
 * pasted into a post or a message.
 *
 * It is laid out for a thumbnail, not a page — a name, a level and one
 * sentence, large enough to read in a feed on a phone. Everything on it comes
 * from the content modules, so it cannot disagree with the site it previews.
 */
import { createHash } from 'node:crypto';

import { CONTENT } from '../content/content';

/** 1.91:1, the ratio LinkedIn and X both render without cropping. */
export const CARD_WIDTH = 1200;
export const CARD_HEIGHT = 630;

/** Home-screen and share-sheet icon size iOS asks for. */
export const TOUCH_ICON_SIZE = 180;

export type CardContent = {
  readonly eyebrow: string;
  readonly name: string;
  readonly statement: string;
  readonly site: string;
  readonly location: string;
};

export const buildCardContent = (): CardContent => ({
  eyebrow: CONTENT.HERO.eyebrow,
  name: CONTENT.HERO.name,
  statement: CONTENT.HERO.statement,
  site: CONTENT.SITE_URL.replace(/^https?:\/\/(www\.)?/, ''),
  location: CONTENT.LOCATION,
});

const VERSION_LENGTH = 8;

/**
 * Changes whenever the card would. The image is served with a year-long
 * immutable cache and platforms keep their own copy per URL, so the version
 * rides in the query string: new content is a new URL, never a stale preview.
 */
export const cardVersion = (content: CardContent): string =>
  createHash('sha256')
    .update(JSON.stringify(content))
    .digest('hex')
    .slice(0, VERSION_LENGTH);

const escapeHtml = (text: string): string =>
  text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/** Site tokens, restated because the card is rendered outside the page. */
const BASE_CSS = `
  * { box-sizing: border-box; margin: 0; }
  html, body { background: #0a0a0b; color: #f2f4f8; }
  body { font-family: "Inter Variable", sans-serif; -webkit-font-smoothing: antialiased; }
  .mono { font-family: "JetBrains Mono Variable", monospace; }
`;

export const renderCardHtml = (content: CardContent, fonts: string): string =>
  `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <style>
      ${fonts}
      ${BASE_CSS}
      body { width: ${CARD_WIDTH}px; height: ${CARD_HEIGHT}px; overflow: hidden; }
      .card {
        position: relative;
        width: 100%;
        height: 100%;
        padding: 72px 80px;
        display: flex;
        flex-direction: column;
        background:
          radial-gradient(900px 520px at 100% 0%, rgba(127, 179, 255, 0.16), transparent 70%),
          #0a0a0b;
      }
      .eyebrow { font-size: 28px; color: #7fb3ff; }
      .name { margin-top: 20px; font-size: 112px; font-weight: 700; line-height: 1.05; letter-spacing: -0.02em; }
      .statement { margin-top: 32px; max-width: 1000px; font-size: 34px; line-height: 1.4; color: #a3abba; }
      .foot { margin-top: auto; display: flex; justify-content: space-between; align-items: baseline; font-size: 26px; }
      .site { color: #f2f4f8; }
      .location { color: #727a88; }
    </style>
  </head>
  <body>
    <main class="card">
      <p class="eyebrow mono">${escapeHtml(content.eyebrow)}</p>
      <h1 class="name mono">${escapeHtml(content.name)}</h1>
      <p class="statement">${escapeHtml(content.statement)}</p>
      <p class="foot mono">
        <span class="site">${escapeHtml(content.site)}</span>
        <span class="location">${escapeHtml(content.location)}</span>
      </p>
    </main>
  </body>
</html>`;

export const renderTouchIconHtml = (initials: string, fonts: string): string =>
  `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <style>
      ${fonts}
      ${BASE_CSS}
      body {
        width: ${TOUCH_ICON_SIZE}px;
        height: ${TOUCH_ICON_SIZE}px;
        display: grid;
        place-items: center;
        overflow: hidden;
      }
      .mark { font-size: 84px; font-weight: 700; letter-spacing: -0.04em; color: #7fb3ff; }
    </style>
  </head>
  <body>
    <p class="mark mono">${escapeHtml(initials)}</p>
  </body>
</html>`;

/** A case study's card: the project and its one line, under the same frame. */
export const buildCaseStudyCardContent = (study: {
  readonly title: string;
  readonly subline: string;
}): CardContent => ({
  eyebrow: `// case study · ${CONTENT.HERO.name}`,
  name: study.title.split(':')[0] ?? study.title,
  statement: study.subline,
  site: CONTENT.SITE_URL.replace(/^https?:\/\/(www\.)?/, ''),
  location: CONTENT.LOCATION,
});
