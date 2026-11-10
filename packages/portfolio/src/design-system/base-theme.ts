/**
 * The base theme every other theme is derived from: dark by default with a
 * daylight twin, monospace accents, blue. `createTheme` overrides only what a
 * theme changes, so a new theme is a few lines.
 */
import type {
  ColorTokens,
  ShapeTokens,
  Theme,
  TypographyTokens,
} from './tokens';

export const BASE_DARK: ColorTokens = {
  bg: '#0a0a0b',
  paper: '#101013',
  paperBorder: '#1f1f25',
  paperBorderHover: '#2e2e36',
  text: '#f2f4f8',
  textMuted: '#a3abba',
  // 5.6:1 on paper; the old #727a88 measured 4.39:1 and failed AA.
  textSubtle: '#848c9a',
  accent: '#7fb3ff',
  accentHover: '#a6cbff',
  accentStrong: '#4c8de8',
  accentDeep: '#1e5baf',
  // White text keeps 8:1 on the primary button's hover.
  accentDeepHover: '#1a4f99',
  accentSoft: 'rgba(127, 179, 255, 0.12)',
  accentGlow: 'rgba(127, 179, 255, 0.18)',
  onAccent: '#ffffff',
  success: '#3fb950',
  navBg: 'rgba(10, 10, 11, 0.85)',
  scrim: 'rgba(10, 10, 11, 0.8)',
  handwrittenTextA: '#b388ff',
  handwrittenTextB: '#e0ccff',
  heat: ['#16161c', '#143f74', '#2361ab', '#3f87e2', '#86baff'],
};

export const BASE_LIGHT: ColorTokens = {
  bg: '#f4f6f9',
  paper: '#ffffff',
  paperBorder: '#d9dee6',
  paperBorderHover: '#b9c1cd',
  text: '#0d1117',
  textMuted: '#424a57',
  textSubtle: '#59616e',
  accent: '#1557b0',
  accentHover: '#0d3f86',
  accentStrong: '#1e5baf',
  accentDeep: '#1e5baf',
  accentDeepHover: '#0d3f86',
  accentSoft: 'rgba(21, 87, 176, 0.08)',
  accentGlow: 'rgba(21, 87, 176, 0.2)',
  onAccent: '#ffffff',
  success: '#1f7a33',
  navBg: 'rgba(244, 246, 249, 0.88)',
  scrim: 'rgba(13, 17, 23, 0.6)',
  handwrittenTextA: '#6b3fb5',
  handwrittenTextB: '#9a6be0',
  heat: ['#e6e9ee', '#b6d3fb', '#6aa5f0', '#2f74d0', '#134b9c'],
};

/** Paper: black on white whatever the theme, so every printout reads alike. */
export const PRINT_COLORS: ColorTokens = {
  ...BASE_LIGHT,
  bg: '#ffffff',
  paper: '#ffffff',
  paperBorder: '#c9ced6',
  text: '#000000',
  textMuted: '#1f242c',
  textSubtle: '#3a414c',
  accent: '#0b3d82',
  accentHover: '#0b3d82',
};

export const BASE_TYPOGRAPHY: TypographyTokens = {
  body: 'sans',
  accent: 'mono',
  display: 'mono',
  displayWeight: 600,
  displayTracking: '0.01em',
  sectionNumbers: true,
};

export const BASE_SHAPE: ShapeTokens = {
  radiusSm: '6px',
  radiusMd: '10px',
  radiusLg: '14px',
};

export const BASE_THEME: Theme = {
  id: 'base',
  description: 'Dark, monospace accents, blue.',
  scheme: 'auto',
  dark: BASE_DARK,
  light: BASE_LIGHT,
  typography: BASE_TYPOGRAPHY,
  shape: BASE_SHAPE,
  resumeAccent: '#0b6bcb',
};

/** An accent colour, its tints derived: `rgb` is `r, g, b` of `accent`. */
export type Accent = Pick<
  ColorTokens,
  'accent' | 'accentHover' | 'accentStrong' | 'accentDeep' | 'accentDeepHover'
> & { readonly rgb: string; readonly heat: ColorTokens['heat'] };

export const withAccent = (
  colors: ColorTokens,
  scheme: 'dark' | 'light',
  { rgb, ...accent }: Accent
): ColorTokens => ({
  ...colors,
  ...accent,
  accentSoft: `rgba(${rgb}, ${scheme === 'dark' ? '0.12' : '0.08'})`,
  accentGlow: `rgba(${rgb}, ${scheme === 'dark' ? '0.18' : '0.2'})`,
});

export type ThemeInput = {
  readonly id: string;
  readonly description: string;
  readonly scheme?: Theme['scheme'];
  readonly dark?: Partial<ColorTokens>;
  readonly light?: Partial<ColorTokens>;
  readonly typography?: Partial<TypographyTokens>;
  readonly shape?: Partial<ShapeTokens>;
  readonly resumeAccent?: string;
};

/** A complete theme: the base, with only what this one changes. */
export const createTheme = (
  input: ThemeInput,
  base: Theme = BASE_THEME
): Theme => ({
  id: input.id,
  description: input.description,
  scheme: input.scheme ?? base.scheme,
  dark: { ...base.dark, ...input.dark },
  light: { ...base.light, ...input.light },
  typography: { ...base.typography, ...input.typography },
  shape: { ...base.shape, ...input.shape },
  resumeAccent: input.resumeAccent ?? base.resumeAccent,
});
