/**
 * A whole theme from a visual research: a hue, how saturated, which typefaces,
 * which corners. The research comes from the market knowledge base
 * (`src/market/research/`), so a role's look is derived from what its
 * readers respond to rather than hand-picked hex codes.
 *
 * Colours are chosen in OKLCH (perceptually even lightness, via `culori`) and
 * each one that carries text is solved for contrast: its lightness moves
 * until it holds WCAG AA against every surface it sits on. A new hue cannot
 * produce an unreadable theme; `themes.test.ts` checks the output anyway.
 */
import { clampChroma, formatHex, wcagContrast, type Oklch } from 'culori';

import { BASE_DARK, BASE_LIGHT, BASE_SHAPE } from './base-theme';
import type {
  ColorTokens,
  FontRole,
  ShapeTokens,
  Theme,
  TypographyTokens,
} from './tokens';

export type Chroma = 'muted' | 'moderate' | 'vivid';
export type Corners = 'square' | 'soft' | 'round';

/** Everything a theme is derived from. */
export type VisualStyle = {
  /** `auto` follows the visitor; `light` is always light (a document). */
  readonly scheme: 'auto' | 'light';
  /** OKLCH hue of the accent, in degrees. */
  readonly hue: number;
  readonly chroma: Chroma;
  /** Headline face. */
  readonly display: FontRole;
  /** Labels, eyebrows and metadata. */
  readonly accent: 'sans' | 'mono';
  readonly corners: Corners;
};

/** WCAG AA, with a margin so rounding to hex never lands under it. */
const AA = 4.6;
const ACCENT_CHROMA: Readonly<Record<Chroma, number>> = {
  muted: 0.07,
  moderate: 0.12,
  vivid: 0.17,
};
/** How much of the hue tints the neutrals (backgrounds, borders, text). */
const NEUTRAL_CHROMA: Readonly<Record<Chroma, number>> = {
  muted: 0.004,
  moderate: 0.008,
  vivid: 0.012,
};
const LIGHTNESS_STEP = 0.005;

const SHAPES: Readonly<Record<Corners, ShapeTokens>> = {
  square: { radiusSm: '2px', radiusMd: '3px', radiusLg: '4px' },
  soft: BASE_SHAPE,
  round: { radiusSm: '8px', radiusMd: '14px', radiusLg: '20px' },
};

const hex = (l: number, c: number, h: number): string =>
  formatHex(
    clampChroma({ mode: 'oklch', l, c, h } satisfies Oklch, 'oklch', 'rgb')
  );

const contrastAll = (color: string, surfaces: readonly string[]): number =>
  Math.min(...surfaces.map((surface) => wcagContrast(color, surface)));

/** A colour to find: its hue and chroma, where to start, which way to move. */
type Target = {
  readonly start: number;
  readonly c: number;
  readonly h: number;
  /** +1 moves lighter (for dark surfaces), −1 darker. */
  readonly toward: 1 | -1;
};

/**
 * The colour of hue `h` nearest lightness `start` that holds AA on every
 * surface, moving `toward` lighter or darker until it does.
 */
export const solveColor = (
  { start, c, h, toward }: Target,
  surfaces: readonly string[]
): string => {
  for (let l = start; l >= 0 && l <= 1; l += toward * LIGHTNESS_STEP) {
    const color = hex(l, c, h);
    if (contrastAll(color, surfaces) >= AA) return color;
  }
  return toward === 1 ? '#ffffff' : '#000000';
};

const rgbOf = (color: string): string => {
  const n = Number.parseInt(color.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255].join(', ');
};

/** `rgba()` of a colour, for the translucent tokens. */
const alpha = (color: string, a: number): string =>
  `rgba(${rgbOf(color)}, ${String(a)})`;

/** Composite of a translucent tint over a surface, for the contrast solver. */
const over = (color: string, a: number, surface: string): string => {
  const top = rgbOf(color).split(', ').map(Number);
  const below = rgbOf(surface).split(', ').map(Number);
  const mixed = top.map((value, i) =>
    Math.round(value * a + (below[i] ?? 0) * (1 - a))
  );
  return `#${mixed.map((value) => value.toString(16).padStart(2, '0')).join('')}`;
};

const ramp = (
  zero: string,
  stops: readonly number[],
  c: number,
  h: number
): ColorTokens['heat'] => {
  const [a = 0, b = 0, d = 0, e = 0] = stops;
  return [zero, hex(a, c, h), hex(b, c, h), hex(d, c, h), hex(e, c, h)];
};

const SOFT = { dark: 0.12, light: 0.08 } as const;
const GLOW = { dark: 0.18, light: 0.2 } as const;

export const darkColors = (research: VisualStyle): ColorTokens => {
  const { hue: h } = research;
  const n = NEUTRAL_CHROMA[research.chroma];
  const c = ACCENT_CHROMA[research.chroma];
  const bg = hex(0.15, n, h);
  const paper = hex(0.18, n * 1.2, h);
  const surfaces = [bg, paper];
  const accent = solveColor({ start: 0.78, c, h, toward: 1 }, [
    ...surfaces,
    over(hex(0.78, c, h), SOFT.dark, paper),
  ]);
  const accentDeep = solveColor({ start: 0.52, c, h, toward: -1 }, ['#ffffff']);
  return {
    ...BASE_DARK,
    bg,
    paper,
    paperBorder: hex(0.27, n * 1.5, h),
    paperBorderHover: hex(0.34, n * 1.5, h),
    text: hex(0.96, n, h),
    textMuted: solveColor({ start: 0.76, c: n * 2, h, toward: 1 }, surfaces),
    textSubtle: solveColor({ start: 0.64, c: n * 2, h, toward: 1 }, surfaces),
    accent,
    accentHover: solveColor(
      { start: 0.86, c: c * 0.8, h, toward: 1 },
      surfaces
    ),
    accentStrong: hex(0.66, c, h),
    accentDeep,
    accentDeepHover: solveColor({ start: 0.46, c, h, toward: -1 }, ['#ffffff']),
    accentSoft: alpha(accent, SOFT.dark),
    accentGlow: alpha(accent, GLOW.dark),
    onAccent: '#ffffff',
    navBg: alpha(bg, 0.85),
    scrim: alpha(bg, 0.8),
    heat: ramp(hex(0.22, n, h), [0.32, 0.45, 0.6, 0.8], c, h),
  };
};

export const lightColors = (research: VisualStyle): ColorTokens => {
  const { hue: h } = research;
  const n = NEUTRAL_CHROMA[research.chroma];
  const c = ACCENT_CHROMA[research.chroma];
  const bg = hex(0.975, n, h);
  const paper = '#ffffff';
  const surfaces = [bg, paper];
  const accent = solveColor({ start: 0.5, c, h, toward: -1 }, [
    ...surfaces,
    over(hex(0.5, c, h), SOFT.light, bg),
  ]);
  const accentDeep = solveColor({ start: 0.5, c, h, toward: -1 }, ['#ffffff']);
  return {
    ...BASE_LIGHT,
    bg,
    paper,
    paperBorder: hex(0.9, n * 2, h),
    paperBorderHover: hex(0.8, n * 2, h),
    text: hex(0.2, n * 2, h),
    textMuted: solveColor({ start: 0.42, c: n * 3, h, toward: -1 }, surfaces),
    textSubtle: solveColor({ start: 0.5, c: n * 3, h, toward: -1 }, surfaces),
    accent,
    accentHover: solveColor({ start: 0.4, c, h, toward: -1 }, surfaces),
    accentStrong: accentDeep,
    accentDeep,
    accentDeepHover: solveColor({ start: 0.38, c, h, toward: -1 }, ['#ffffff']),
    accentSoft: alpha(accent, SOFT.light),
    accentGlow: alpha(accent, GLOW.light),
    onAccent: '#ffffff',
    navBg: alpha(bg, 0.88),
    scrim: alpha(hex(0.2, n * 2, h), 0.6),
    heat: ramp(hex(0.92, n, h), [0.86, 0.72, 0.56, 0.42], c, h),
  };
};

export const typographyOf = (research: VisualStyle): TypographyTokens => ({
  body: 'sans',
  accent: research.accent,
  display: research.display,
  displayWeight:
    research.display === 'serif'
      ? 600
      : research.display === 'sans'
        ? 680
        : 620,
  displayTracking:
    research.display === 'sans'
      ? '-0.015em'
      : research.display === 'mono'
        ? '-0.01em'
        : '0',
  // Numbered sections read as code; a document does without them.
  sectionNumbers: research.accent === 'mono',
});

/** The complete theme a visual style describes. */
export const themeFromBrief = (
  id: string,
  description: string,
  research: VisualStyle
): Theme => {
  const light = lightColors(research);
  return {
    id,
    description,
    scheme: research.scheme,
    dark: darkColors(research),
    light,
    typography: typographyOf(research),
    shape: SHAPES[research.corners],
    // The résumé is printed on white: the light accent already holds AA there.
    resumeAccent: light.accentDeep,
  };
};
