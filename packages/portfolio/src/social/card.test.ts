/**
 * Renders the real images through Chromium, the way the build produces them.
 * Needs the Playwright browser: `bunx playwright install chromium`.
 */
import { describe, expect, test } from 'bun:test';

import { CONTENT } from '../content/content';
import { DEFAULT_OG_IMAGE } from '../lib/seo';
import {
  CARD_HEIGHT,
  CARD_WIDTH,
  TOUCH_ICON_SIZE,
  buildCardContent,
  cardVersion,
} from './card';
import { renderCardPng, renderTouchIconPng } from './render';

const RENDER_TIMEOUT_MS = 120_000;
/** LinkedIn and X both reject preview images above this. */
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47];
const IHDR_WIDTH_OFFSET = 16;
const IHDR_HEIGHT_OFFSET = 20;

/** Width and height straight from the PNG header, not from what was asked. */
const pngSize = (bytes: Uint8Array): { width: number; height: number } => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return {
    width: view.getUint32(IHDR_WIDTH_OFFSET),
    height: view.getUint32(IHDR_HEIGHT_OFFSET),
  };
};

describe('the share card', () => {
  test(
    'is a PNG at the size the meta tags declare, with nothing cut off',
    async () => {
      // renderCardPng throws when any text overflows the card, so reaching
      // the assertions is the overflow check.
      const bytes = await renderCardPng(buildCardContent());
      expect([...bytes.slice(0, PNG_SIGNATURE.length)]).toEqual(PNG_SIGNATURE);
      expect(pngSize(bytes)).toEqual({
        width: DEFAULT_OG_IMAGE.width,
        height: DEFAULT_OG_IMAGE.height,
      });
      expect(pngSize(bytes)).toEqual({
        width: CARD_WIDTH,
        height: CARD_HEIGHT,
      });
      expect(bytes.byteLength).toBeLessThan(MAX_IMAGE_BYTES);
    },
    RENDER_TIMEOUT_MS
  );

  test(
    'fails loudly instead of shipping clipped text',
    async () => {
      const oversized = {
        ...buildCardContent(),
        statement: 'A sentence that keeps going. '.repeat(40),
      };
      expect(renderCardPng(oversized)).rejects.toThrow(/overflows/);
    },
    RENDER_TIMEOUT_MS
  );

  test('says what the site says', () => {
    const card = buildCardContent();
    expect(card.name).toBe(CONTENT.HERO.name);
    expect(card.statement).toBe(CONTENT.HERO.statement);
    expect(CONTENT.SITE_URL).toContain(card.site);
  });

  test('gets a new URL whenever its content changes', () => {
    const card = buildCardContent();
    expect(DEFAULT_OG_IMAGE.url).toContain(`?v=${cardVersion(card)}`);
    expect(cardVersion({ ...card, statement: 'Something else.' })).not.toBe(
      cardVersion(card)
    );
  });
});

describe('the touch icon', () => {
  test(
    'is a square PNG at the size iOS asks for',
    async () => {
      const bytes = await renderTouchIconPng(CONTENT.MONOGRAM_INITIALS);
      expect(pngSize(bytes)).toEqual({
        width: TOUCH_ICON_SIZE,
        height: TOUCH_ICON_SIZE,
      });
    },
    RENDER_TIMEOUT_MS
  );
});
