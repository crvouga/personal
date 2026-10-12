import { describe, expect, test } from 'bun:test';

import {
  desktopChromeUserAgent,
  titleLooksBlocked,
} from './screenshot-browser';

describe('desktopChromeUserAgent', () => {
  test('identifies as desktop Chrome and omits the headless token', () => {
    const ua = desktopChromeUserAgent('153.0.8010.12');
    expect(ua.includes('Headless')).toBe(false);
    expect(ua.includes('Chrome/153.0.8010.12')).toBe(true);
    expect(ua.startsWith('Mozilla/5.0')).toBe(true);
  });
});

describe('titleLooksBlocked', () => {
  test('matches bot walls and ignores real page titles', () => {
    expect(titleLooksBlocked('Just a moment...')).toBe(true);
    expect(titleLooksBlocked('403 Forbidden')).toBe(true);
    expect(titleLooksBlocked('Attention Required! | Cloudflare')).toBe(true);
    expect(titleLooksBlocked('Welcome | My Orchard')).toBe(false);
    expect(
      titleLooksBlocked('OneOrigin: Governed AI for Higher Education')
    ).toBe(false);
  });
});
