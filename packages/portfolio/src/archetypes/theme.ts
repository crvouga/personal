/**
 * Look and feel per archetype: colour tokens and a few layout switches over
 * the site's one stylesheet. A theme changes the accent, the typography and
 * the density of decoration; it never changes the structure, so every
 * component and every accessibility check holds for all of them.
 *
 * `archetypes.test.ts` holds each palette to WCAG AA against the surfaces in
 * `global.css`.
 */
import type { ArchetypeId } from './definitions';

/** The accent-derived tokens of `global.css`, as hex or `r, g, b`. */
export type Palette = {
  readonly accent: string;
  readonly accentHover: string;
  readonly accentStrong: string;
  /** Primary-button fill; white text must hold 4.5:1 on it. */
  readonly accentDeep: string;
  readonly accentDeepHover: string;
  /** `r, g, b` of the accent, for the translucent tints. */
  readonly accentRgb: string;
  /** Contribution heatmap ramp, quietest to strongest. */
  readonly heat: readonly [string, string, string, string];
};

/** Layout switches, matched by `:root[data-look~='…']` in global.css. */
export type Look = 'sans' | 'serif-display' | 'plain-headings' | 'square';

export type Theme = {
  /** `auto` follows the visitor's colour scheme; `light` is always light. */
  readonly scheme: 'auto' | 'light';
  /** Undefined keeps the stylesheet's own palette. */
  readonly dark?: Palette;
  readonly light?: Palette;
  readonly looks: readonly Look[];
  /** Accent for the résumé PDF, which is always printed on white. */
  readonly resumeAccent: string;
};

const TEAL_DARK: Palette = {
  accent: '#5fd4c4',
  accentHover: '#8ee6d9',
  accentStrong: '#2aa898',
  accentDeep: '#0f6b61',
  accentDeepHover: '#0b574f',
  accentRgb: '95, 212, 196',
  heat: ['#0f3d38', '#17655c', '#27998b', '#74e0d0'],
};
const TEAL_LIGHT: Palette = {
  accent: '#0b665c',
  accentHover: '#084c45',
  accentStrong: '#0f6b61',
  accentDeep: '#0f6b61',
  accentDeepHover: '#084c45',
  accentRgb: '11, 102, 92',
  heat: ['#b5e6df', '#62c4b6', '#1f9082', '#0a5a51'],
};
const AMBER_DARK: Palette = {
  accent: '#ffb454',
  accentHover: '#ffcf8f',
  accentStrong: '#e08a1b',
  accentDeep: '#8a4a00',
  accentDeepHover: '#703c00',
  accentRgb: '255, 180, 84',
  heat: ['#4a2c08', '#80500f', '#c07a1a', '#ffc170'],
};
const AMBER_LIGHT: Palette = {
  accent: '#8a4300',
  accentHover: '#663200',
  accentStrong: '#8a4a00',
  accentDeep: '#8a4a00',
  accentDeepHover: '#663200',
  accentRgb: '138, 67, 0',
  heat: ['#f6d9ad', '#e6a955', '#b76d10', '#7a3d00'],
};
const NAVY_LIGHT: Palette = {
  accent: '#1b3f73',
  accentHover: '#122c52',
  accentStrong: '#1b3f73',
  accentDeep: '#1b3f73',
  accentDeepHover: '#122c52',
  accentRgb: '27, 63, 115',
  heat: ['#c3d2e8', '#7f9cc8', '#3c63a1', '#1b3f73'],
};
const INK_LIGHT: Palette = {
  accent: '#7a2e1d',
  accentHover: '#571f13',
  accentStrong: '#7a2e1d',
  accentDeep: '#7a2e1d',
  accentDeepHover: '#571f13',
  accentRgb: '122, 46, 29',
  heat: ['#ecd0c8', '#cf9484', '#a3543f', '#7a2e1d'],
};

export const THEMES: Readonly<Record<ArchetypeId, Theme>> = {
  /** The house style: dark, monospace headings, blue accent. */
  'tech-company-senior-developer': {
    scheme: 'auto',
    looks: [],
    resumeAccent: '#0b6bcb',
  },
  /** Calmer and more editorial: sans headings, teal accent. */
  'tech-company-staff-engineer': {
    scheme: 'auto',
    dark: TEAL_DARK,
    light: TEAL_LIGHT,
    looks: ['sans'],
    resumeAccent: '#0b665c',
  },
  /** A terminal at work: monospace everywhere, warm amber accent. */
  'startup-small-company-senior-developer': {
    scheme: 'auto',
    dark: AMBER_DARK,
    light: AMBER_LIGHT,
    looks: [],
    resumeAccent: '#8a4300',
  },
  /** A corporate document: always light, sans, navy, square corners. */
  'corporate-large-company-senior-developer': {
    scheme: 'light',
    light: NAVY_LIGHT,
    looks: ['sans', 'plain-headings', 'square'],
    resumeAccent: '#1b3f73',
  },
  /** A consultant's proposal: always light, serif headings, ink accent. */
  'corporate-contractor-systems-architect': {
    scheme: 'light',
    light: INK_LIGHT,
    looks: ['sans', 'serif-display', 'plain-headings', 'square'],
    resumeAccent: '#7a2e1d',
  },
};

/** The light surfaces of `global.css`; a forced-light theme restates them. */
export const LIGHT_SURFACES: Readonly<Record<string, string>> = {
  bg: '#f4f6f9',
  paper: '#ffffff',
  'paper-border': '#d9dee6',
  'paper-border-hover': '#b9c1cd',
  text: '#0d1117',
  'text-muted': '#424a57',
  'text-subtle': '#59616e',
  success: '#1f7a33',
  'nav-bg': 'rgba(244, 246, 249, 0.88)',
  scrim: 'rgba(13, 17, 23, 0.6)',
  'handwritten-text-a': '#6b3fb5',
  'handwritten-text-b': '#9a6be0',
  'gh-0': '#e6e9ee',
};

export const paletteTokens = (
  palette: Palette,
  scheme: 'dark' | 'light'
): Record<string, string> => ({
  accent: palette.accent,
  'accent-hover': palette.accentHover,
  'accent-strong': palette.accentStrong,
  'accent-deep': palette.accentDeep,
  'accent-deep-hover': palette.accentDeepHover,
  'accent-soft': `rgba(${palette.accentRgb}, ${scheme === 'dark' ? '0.12' : '0.08'})`,
  'accent-glow': `rgba(${palette.accentRgb}, ${scheme === 'dark' ? '0.18' : '0.2'})`,
  'gh-1': palette.heat[0],
  'gh-2': palette.heat[1],
  'gh-3': palette.heat[2],
  'gh-4': palette.heat[3],
});

/**
 * Scoped to one archetype, so a page can carry several themes and show the
 * one named on `<html data-archetype>`. The attribute also outranks the
 * stylesheet's own `:root`, wherever the two land in <head>.
 */
const rootOf = (id: ArchetypeId): string => `:root[data-archetype='${id}']`;

const block = (selector: string, tokens: Record<string, string>): string =>
  `${selector}{${Object.entries(tokens)
    .map(([name, value]) => `--${name}:${value}`)
    .join(';')}}`;

/**
 * One archetype's theme as CSS, or '' for the house style. Screen-only, so
 * the print palette in global.css still applies on paper.
 */
export const themeCss = (id: ArchetypeId): string => {
  const theme = THEMES[id];
  const ROOT = rootOf(id);
  const rules: string[] = [];
  if (theme.scheme === 'light') {
    rules.push(
      `${ROOT}{color-scheme:light}`,
      block(ROOT, {
        ...LIGHT_SURFACES,
        ...(theme.light === undefined
          ? {}
          : paletteTokens(theme.light, 'light')),
      })
    );
  } else {
    if (theme.dark !== undefined) {
      rules.push(block(ROOT, paletteTokens(theme.dark, 'dark')));
    }
    if (theme.light !== undefined) {
      rules.push(
        `@media (prefers-color-scheme: light){${block(ROOT, paletteTokens(theme.light, 'light'))}}`
      );
    }
  }
  return rules.length === 0 ? '' : `@media screen{${rules.join('')}}`;
};

/**
 * Every theme at once, for the pages that are not built per archetype
 * (`/projects/`, case studies): they carry all of them and a script names
 * the one the visitor arrived with.
 */
export const ALL_THEMES_CSS: string = (Object.keys(THEMES) as ArchetypeId[])
  .map(themeCss)
  .join('');

/** Archetype id → its `data-look` value, for the same script. */
export const LOOKS_BY_ARCHETYPE: Readonly<Record<string, string>> =
  Object.fromEntries(
    (Object.keys(THEMES) as ArchetypeId[]).map((id) => [
      id,
      THEMES[id].looks.join(' '),
    ])
  );
