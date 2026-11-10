import { describe, expect, test } from 'bun:test';

import { ARCHETYPE_IDS } from '../archetypes/definitions';
import { DEFAULT_THEME_CSS, THEMES } from '../archetypes/theme';
import { BASE_THEME, PRINT_COLORS, createTheme } from './base-theme';
import { colorVars, themeCss } from './css';
import type { ColorTokens, Theme } from './tokens';

/**
 * WCAG AA (4.5:1) for every text/background token pair the components use,
 * in every theme and every colour scheme it can show, so a token edit cannot
 * quietly drop below it.
 */
const AA = 4.5;

type Rgba = readonly [number, number, number, number];

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

/** A translucent colour is what it looks like over the surface below it. */
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

const contrast = (a: Rgba, b: Rgba): number => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05);
};

/** [text, background, optional surface under a translucent background]. */
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

const failures = (colors: ColorTokens): string[] => {
  const tokens = colorVars(colors);
  return PAIRS.flatMap(([fg, bg, surface]) => {
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
};

/** The palettes a theme can actually show. */
const shown = (theme: Theme): [string, ColorTokens][] =>
  theme.scheme === 'light'
    ? [['light', theme.light]]
    : [
        ['dark', theme.dark],
        ['light', theme.light],
      ];

const ALL: readonly Theme[] = [
  BASE_THEME,
  ...ARCHETYPE_IDS.map((id) => THEMES[id]),
];

describe('design system', () => {
  test('every theme holds WCAG AA in every scheme it shows', () => {
    const failing = ALL.flatMap((theme) =>
      shown(theme).flatMap(([scheme, colors]) =>
        failures(colors).map((failure) => `${theme.id} ${scheme}: ${failure}`)
      )
    );
    expect(failing).toEqual([]);
  });

  test('paper is black on white whatever the theme', () => {
    expect(failures(PRINT_COLORS)).toEqual([]);
    for (const theme of ALL) {
      expect(themeCss(theme)).toContain(
        `@media print{[data-theme='${theme.id}']{--bg:#ffffff`
      );
    }
  });

  test('the résumé accent is readable on white paper', () => {
    const faint = ALL.filter(
      (theme) => contrast(parse(theme.resumeAccent), parse('#ffffff')) < AA
    ).map((theme) => theme.id);
    expect(faint).toEqual([]);
  });

  test('every archetype has its own theme, distinct from the others', () => {
    for (const id of ARCHETYPE_IDS) expect(THEMES[id].id).toBe(id);
    const looks = ARCHETYPE_IDS.map((id) =>
      JSON.stringify({ ...THEMES[id], id: '', description: '' })
    );
    expect(new Set(looks).size).toBe(ARCHETYPE_IDS.length);
  });

  test('a theme is injectable: scoped to its own data-theme, schemes pinnable', () => {
    const css = themeCss(THEMES['tech-company-staff-engineer']);
    expect(css).toContain("[data-theme='tech-company-staff-engineer']{");
    expect(css).toContain("[data-scheme='light']");
    expect(css).toContain("[data-scheme='dark']");
    expect(DEFAULT_THEME_CSS.startsWith(':root{')).toBe(true);
  });

  test('createTheme overrides only what it is given', () => {
    const theme = createTheme({
      id: 'probe',
      description: 'probe',
      typography: { display: 'serif' },
    });
    expect(theme.typography).toEqual({
      ...BASE_THEME.typography,
      display: 'serif',
    });
    expect(theme.dark).toEqual(BASE_THEME.dark);
  });
});
