import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SOURCE = readFileSync(
  join(import.meta.dir, 'GalleryDialog.astro'),
  'utf8'
);

/**
 * The slide (`img` or `iframe`) is created by the component's inline script, so
 * it never carries Astro's scoping attribute. A plain `.stage img` rule
 * compiles to `img[data-astro-cid-…]` and silently matches nothing: the video
 * shrinks to its intrinsic size and the image renders uncropped-but-oversized.
 * Nothing else fails when that happens, so assert the selectors stay global.
 */
describe('gallery dialog slide styles', () => {
  for (const element of ['img']) {
    test(`${element} is styled with a :global selector`, () => {
      expect(SOURCE).toContain(`.stage :global(${element})`);
    });
  }

  test('no scoped selector targets a slide element', () => {
    const scoped = /^\s*\.stage (img|iframe)[\s,{]/m.test(SOURCE);
    expect(scoped).toBe(false);
  });
});
