/**
 * Renders the share card and the touch icon to PNG with the same Chromium the
 * resume uses. PNG rather than WebP because link-preview crawlers are not
 * browsers: several of them, LinkedIn's among them, do not reliably decode
 * WebP, and a preview that fails renders as a bare URL.
 *
 * Runs under Node inside `astro build` (and `astro dev`), so it uses only
 * portable APIs — no `import.meta.dir`, no Bun globals.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

import {
  CARD_HEIGHT,
  CARD_WIDTH,
  TOUCH_ICON_SIZE,
  renderCardHtml,
  renderTouchIconHtml,
  type CardContent,
} from './card';

const FONT_DIR = path.join(process.cwd(), 'public', 'fonts');

const fontFace = (family: string, file: string): string => {
  const woff2 = readFileSync(path.join(FONT_DIR, file)).toString('base64');
  return `@font-face { font-family: "${family}"; font-weight: 100 900; font-style: normal; src: url(data:font/woff2;base64,${woff2}) format("woff2"); }`;
};

/** The site's own fonts, so the card looks like the page it links to. */
const fontFaceCss = (): string =>
  [
    fontFace('Inter Variable', 'inter-variable.woff2'),
    fontFace('JetBrains Mono Variable', 'jetbrains-mono-variable.woff2'),
  ].join('\n');

type Size = { readonly width: number; readonly height: number };

/** Sub-pixel rounding differences are not overflow. */
const EPSILON_PX = 0.5;

/**
 * Screenshots `html` at exactly `size`. Text that no longer fits fails the
 * build instead of shipping a card with its last line cut off: the pitch is
 * edited far more often than anyone re-opens the preview image.
 */
const renderPng = async (html: string, size: Size): Promise<Uint8Array> => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({
      viewport: size,
      deviceScaleFactor: 1,
    });
    await page.setContent(html, { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    const clipped = await page.evaluate(
      ({ width, height, epsilon }) =>
        Array.from(document.querySelectorAll('body *'))
          .filter((el) => {
            const r = el.getBoundingClientRect();
            return r.right > width + epsilon || r.bottom > height + epsilon;
          })
          .map((el) => el.className || el.tagName.toLowerCase()),
      { ...size, epsilon: EPSILON_PX }
    );
    if (clipped.length > 0) {
      throw new Error(
        `Share image content overflows ${size.width}×${size.height}: ` +
          `${clipped.join(', ')}. Shorten the hero statement in src/content/hero.ts.`
      );
    }
    return await page.screenshot({ type: 'png' });
  } finally {
    await browser.close();
  }
};

export const renderCardPng = (content: CardContent): Promise<Uint8Array> =>
  renderPng(renderCardHtml(content, fontFaceCss()), {
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
  });

export const renderTouchIconPng = (initials: string): Promise<Uint8Array> =>
  renderPng(renderTouchIconHtml(initials, fontFaceCss()), {
    width: TOUCH_ICON_SIZE,
    height: TOUCH_ICON_SIZE,
  });
