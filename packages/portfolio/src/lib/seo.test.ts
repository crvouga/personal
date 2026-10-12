import { describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import {
  DEFAULT_OG_IMAGE,
  HOME_SEO,
  OG_IMAGE_PATH,
  SITE_URL,
  TOUCH_ICON_PATH,
  X_HANDLE,
  seoForIndex,
  seoForNotFound,
} from './seo';

const PAGES_DIR = join(import.meta.dir, '..', 'pages');

/** Past this a feed truncates the headline of a shared link. */
const MAX_SHARE_TITLE_CHARS = 70;
/** X shows about this much; LinkedIn shows less and drops the rest cleanly. */
const MAX_SHARE_DESCRIPTION_CHARS = 200;
/** The image ratio LinkedIn and X render uncropped. */
const SHARE_IMAGE_RATIO = 1.91;
const RATIO_PRECISION = 1;
/** Below this X falls back from the large card to a thumbnail. */
const MIN_SHARE_IMAGE_WIDTH = 1200;

const PAGES = [
  HOME_SEO,
  seoForIndex({ title: 'Listing', description: 'Listing.', path: '/x/' }),
  seoForNotFound(),
];

describe('link previews', () => {
  test('every page carries an absolute https image a crawler can decode', () => {
    for (const page of PAGES) {
      expect(page.image.url.startsWith(`${SITE_URL}/`)).toBe(true);
      expect(page.image.url.startsWith('https://')).toBe(true);
      expect(['image/png', 'image/jpeg']).toContain(page.image.type);
      expect(page.image.alt.trim()).not.toBe('');
    }
  });

  test('the image is large-card sized and will not be cropped', () => {
    const { width, height } = DEFAULT_OG_IMAGE;
    expect(width).toBeGreaterThanOrEqual(MIN_SHARE_IMAGE_WIDTH);
    expect(width / height).toBeCloseTo(SHARE_IMAGE_RATIO, RATIO_PRECISION);
  });

  test('the homepage title and description fit a feed without truncating', () => {
    expect(HOME_SEO.title.length).toBeLessThanOrEqual(MAX_SHARE_TITLE_CHARS);
    expect(HOME_SEO.description.length).toBeLessThanOrEqual(
      MAX_SHARE_DESCRIPTION_CHARS
    );
  });

  test('the X handle is a handle, not a URL', () => {
    expect(X_HANDLE).toMatch(/^@\w+$/);
  });

  test('the endpoints that serve the images match their paths', () => {
    for (const path of [OG_IMAGE_PATH, TOUCH_ICON_PATH]) {
      expect(existsSync(join(PAGES_DIR, `${path.slice(1)}.ts`))).toBe(true);
    }
  });
});
