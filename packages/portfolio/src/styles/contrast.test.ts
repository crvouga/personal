import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * WCAG AA for every text/background token pair the components use, computed
 * from global.css itself so a token edit cannot quietly drop below 4.5:1.
 * (The old --text-subtle measured 4.39:1 on --paper; the primary button's
 * hover 3.34:1.)
 */

const CSS = readFileSync(join(import.meta.dir, 'global.css'), 'utf8');
const AA = 4.5;

type Rgba = readonly [number, number, number, number];

const tokensIn = (block: string): Record<string, string> =>
  Object.fromEntries(
    [...block.matchAll(/--([\w-]+):\s*([^;]+);/g)].map((m) => [
      m[1] ?? '',
      (m[2] ?? '').trim(),
    ])
  );

const blockAfter = (marker: string): string => {
  const start = CSS.indexOf(marker);
  if (start === -1) throw new Error(`global.css has no ${marker}`);
  const open = CSS.indexOf('{', CSS.indexOf(':root', start));
  const close = CSS.indexOf('}', open);
  return CSS.slice(open + 1, close);
};

const DARK = tokensIn(
  CSS.slice(CSS.indexOf(':root'), CSS.indexOf('}', CSS.indexOf(':root')))
);
const LIGHT = {
  ...DARK,
  ...tokensIn(blockAfter('prefers-color-scheme: light')),
};
const PRINT = { ...DARK, ...tokensIn(blockAfter('@media print')) };

const parse = (value: string): Rgba => {
  const hex = /^#([0-9a-f]{6})$/i.exec(value);
  if (hex?.[1] !== undefined) {
    const n = Number.parseInt(hex[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 1];
  }
  const rgba = /^rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)$/.exec(value);
  if (rgba !== null) {
    const [, r, g, b, a] = rgba.map(Number);
    return [r ?? 0, g ?? 0, b ?? 0, a ?? 1];
  }
  throw new Error(`unparseable colour ${value}`);
};

/** A translucent token is what it looks like over the surface below it. */
const over = (top: Rgba, below: Rgba): Rgba => {
  const a = top[3];
  return [0, 1, 2]
    .map((i) => (top[i] ?? 0) * a + (below[i] ?? 0) * (1 - a))
    .concat(1) as unknown as Rgba;
};

const luminance = ([r, g, b]: Rgba): number => {
  const lin = (c: number): number => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
};

export const contrast = (a: Rgba, b: Rgba): number => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05);
};

/** [text token, background token, optional surface under a translucent bg]. */
const PAIRS: readonly (readonly [string, string, string?])[] = [
  ...['text', 'text-muted', 'text-subtle', 'accent', 'accent-hover'].flatMap(
    (fg) =>
      [
        [fg, 'bg'],
        [fg, 'paper'],
      ] as const
  ),
  ['accent', 'accent-soft', 'paper'],
  ['accent', 'accent-soft', 'bg'],
  ['on-accent', 'accent-deep'],
  ['on-accent', 'accent-deep-hover'],
  ['text-muted', 'nav-bg', 'bg'],
  ['handwritten-text-a', 'paper'],
];

const failures = (tokens: Record<string, string>): string[] =>
  PAIRS.flatMap(([fg, bg, surface]) => {
    const fgValue = tokens[fg];
    const bgValue = tokens[bg];
    if (fgValue === undefined || bgValue === undefined)
      return [`missing --${fg} or --${bg}`];
    const below = surface === undefined ? undefined : tokens[surface];
    const back =
      below === undefined ? parse(bgValue) : over(parse(bgValue), parse(below));
    const ratio = contrast(parse(fgValue), back);
    return ratio >= AA ? [] : [`--${fg} on --${bg}: ${ratio.toFixed(2)}`];
  });

describe('colour contrast (WCAG AA, 4.5:1)', () => {
  test('dark theme', () => {
    expect(failures(DARK)).toEqual([]);
  });

  test('light theme', () => {
    expect(failures(LIGHT)).toEqual([]);
  });

  test('print', () => {
    const ink = ['text', 'text-muted', 'text-subtle', 'accent'].filter(
      (fg) => contrast(parse(PRINT[fg] ?? ''), parse(PRINT['paper'] ?? '')) < AA
    );
    expect(ink).toEqual([]);
  });

  test('the checker itself: black on white is 21:1', () => {
    expect(contrast(parse('#000000'), parse('#ffffff'))).toBeCloseTo(21, 5);
  });
});
