/**
 * Each archetype's look and feel, as a design-system theme
 * (`src/design-system/`). A theme changes colour, typefaces and corners;
 * it never changes structure, so every component and every accessibility
 * check holds for all of them. `src/design-system/themes.test.ts` holds each
 * palette to WCAG AA.
 */
import {
  BASE_DARK,
  BASE_LIGHT,
  createTheme,
  withAccent,
  type Accent,
} from '../design-system/base-theme';
import { themeCss } from '../design-system/css';
import type { Theme } from '../design-system/tokens';
import {
  ARCHETYPE_IDS,
  DEFAULT_ARCHETYPE_ID,
  type ArchetypeId,
} from './definitions';

export type { Theme };

const TEAL_DARK: Accent = {
  accent: '#5fd4c4',
  accentHover: '#8ee6d9',
  accentStrong: '#2aa898',
  accentDeep: '#0f6b61',
  accentDeepHover: '#0b574f',
  rgb: '95, 212, 196',
  heat: [BASE_DARK.heat[0], '#0f3d38', '#17655c', '#27998b', '#74e0d0'],
};
const TEAL_LIGHT: Accent = {
  accent: '#0b665c',
  accentHover: '#084c45',
  accentStrong: '#0f6b61',
  accentDeep: '#0f6b61',
  accentDeepHover: '#084c45',
  rgb: '11, 102, 92',
  heat: [BASE_LIGHT.heat[0], '#b5e6df', '#62c4b6', '#1f9082', '#0a5a51'],
};
const AMBER_DARK: Accent = {
  accent: '#ffb454',
  accentHover: '#ffcf8f',
  accentStrong: '#e08a1b',
  accentDeep: '#8a4a00',
  accentDeepHover: '#703c00',
  rgb: '255, 180, 84',
  heat: [BASE_DARK.heat[0], '#4a2c08', '#80500f', '#c07a1a', '#ffc170'],
};
const AMBER_LIGHT: Accent = {
  accent: '#8a4300',
  accentHover: '#663200',
  accentStrong: '#8a4a00',
  accentDeep: '#8a4a00',
  accentDeepHover: '#663200',
  rgb: '138, 67, 0',
  heat: [BASE_LIGHT.heat[0], '#f6d9ad', '#e6a955', '#b76d10', '#7a3d00'],
};
const NAVY_LIGHT: Accent = {
  accent: '#1b3f73',
  accentHover: '#122c52',
  accentStrong: '#1b3f73',
  accentDeep: '#1b3f73',
  accentDeepHover: '#122c52',
  rgb: '27, 63, 115',
  heat: [BASE_LIGHT.heat[0], '#c3d2e8', '#7f9cc8', '#3c63a1', '#1b3f73'],
};
const INK_LIGHT: Accent = {
  accent: '#7a2e1d',
  accentHover: '#571f13',
  accentStrong: '#7a2e1d',
  accentDeep: '#7a2e1d',
  accentDeepHover: '#571f13',
  rgb: '122, 46, 29',
  heat: [BASE_LIGHT.heat[0], '#ecd0c8', '#cf9484', '#a3543f', '#7a2e1d'],
};

const SQUARE = { radiusSm: '2px', radiusMd: '3px', radiusLg: '4px' } as const;

export const THEMES: Readonly<Record<ArchetypeId, Theme>> = {
  'tech-company-senior-developer': createTheme({
    id: 'tech-company-senior-developer',
    description:
      'The house style for product companies: dark, monospace headings, blue. Reads like the tools these teams use every day.',
  }),
  'tech-company-staff-engineer': createTheme({
    id: 'tech-company-staff-engineer',
    description:
      'Calmer and more editorial for staff-level readers: sans throughout, teal, tighter headings. Direction over flourish.',
    dark: withAccent(BASE_DARK, 'dark', TEAL_DARK),
    light: withAccent(BASE_LIGHT, 'light', TEAL_LIGHT),
    typography: {
      accent: 'sans',
      display: 'sans',
      displayWeight: 650,
      displayTracking: '-0.01em',
    },
    resumeAccent: '#0b665c',
  }),
  'startup-small-company-senior-developer': createTheme({
    id: 'startup-small-company-senior-developer',
    description:
      'A terminal at work for founders: monospace, warm amber, tight corners. Built fast, built to ship.',
    dark: withAccent(BASE_DARK, 'dark', AMBER_DARK),
    light: withAccent(BASE_LIGHT, 'light', AMBER_LIGHT),
    typography: { displayWeight: 700, displayTracking: '-0.02em' },
    shape: { radiusSm: '4px', radiusMd: '6px', radiusLg: '8px' },
    resumeAccent: '#8a4300',
  }),
  'corporate-large-company-senior-developer': createTheme({
    id: 'corporate-large-company-senior-developer',
    description:
      'A corporate document for enterprise hiring managers: always light, sans, navy, square corners, no code flourishes.',
    scheme: 'light',
    light: withAccent(BASE_LIGHT, 'light', NAVY_LIGHT),
    typography: {
      accent: 'sans',
      display: 'sans',
      displayWeight: 700,
      displayTracking: '0',
      sectionNumbers: false,
    },
    shape: SQUARE,
    resumeAccent: '#1b3f73',
  }),
  'corporate-contractor-systems-architect': createTheme({
    id: 'corporate-contractor-systems-architect',
    description:
      "A consultant's proposal for clients buying an engagement: always light, serif headings, ink red, square corners.",
    scheme: 'light',
    light: withAccent(BASE_LIGHT, 'light', INK_LIGHT),
    typography: {
      accent: 'sans',
      display: 'serif',
      displayWeight: 600,
      displayTracking: '0',
      sectionNumbers: false,
    },
    shape: SQUARE,
    resumeAccent: '#7a2e1d',
  }),
};

/** The page default, applied at `:root` before any `data-theme`. */
export const DEFAULT_THEME_CSS: string = themeCss(
  THEMES[DEFAULT_ARCHETYPE_ID],
  ':root'
);

/**
 * Every theme at once, for the pages that are not built per archetype
 * (`/projects/`, case studies): they carry all of them and a script names
 * the one the visitor arrived with on `<html data-theme>`.
 */
export const ALL_THEMES_CSS: string = ARCHETYPE_IDS.map((id) =>
  themeCss(THEMES[id])
).join('');
