/**
 * A theme as CSS custom properties, scoped to `[data-theme='<id>']`, so a
 * theme can be injected on `<html>` (a page) or on any element (a story, a
 * preview). `data-scheme="dark|light"` on the same element pins the colour
 * scheme; without it an `auto` theme follows the visitor's. On paper every
 * theme prints in the same black-on-white palette.
 */
import { PRINT_COLORS } from './base-theme';
import { FONT_STACKS, type ColorTokens, type Theme } from './tokens';

const kebab = (name: string): string =>
  name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);

export const colorVars = (colors: ColorTokens): Record<string, string> => {
  const { heat, ...rest } = colors;
  return {
    ...Object.fromEntries(
      Object.entries(rest).map(([name, value]) => [kebab(name), value])
    ),
    ...Object.fromEntries(
      heat.map((value, index) => [`gh-${String(index)}`, value])
    ),
  };
};

/** Typefaces and shape: the same in both schemes. */
export const staticVars = (theme: Theme): Record<string, string> => {
  const { typography, shape } = theme;
  return {
    'font-sans': FONT_STACKS.sans,
    'font-mono': FONT_STACKS.mono,
    'font-serif': FONT_STACKS.serif,
    'font-body': FONT_STACKS[typography.body],
    'font-accent': FONT_STACKS[typography.accent],
    'font-display': FONT_STACKS[typography.display],
    'display-weight': String(typography.displayWeight),
    'display-tracking': typography.displayTracking,
    'section-number-display': typography.sectionNumbers ? 'inline' : 'none',
    'radius-sm': shape.radiusSm,
    'radius-md': shape.radiusMd,
    'radius-lg': shape.radiusLg,
  };
};

const block = (selector: string, vars: Record<string, string>): string =>
  `${selector}{${Object.entries(vars)
    .map(([name, value]) => `--${name}:${value}`)
    .join(';')}}`;

export const themeSelector = (id: string): string => `[data-theme='${id}']`;

/**
 * The theme's CSS. `selector` defaults to its `[data-theme]` scope; pass
 * `:root` to make it the page default.
 */
export const themeCss = (
  theme: Theme,
  selector: string = themeSelector(theme.id)
): string => {
  const on = (suffix: string): string =>
    selector
      .split(',')
      .map((part) => `${part.trim()}${suffix}`)
      .join(',');
  const rules: string[] = [];
  if (theme.scheme === 'light') {
    rules.push(
      `${selector}{color-scheme:light}`,
      block(selector, colorVars(theme.light))
    );
  } else {
    rules.push(
      `${selector}{color-scheme:dark light}`,
      block(selector, colorVars(theme.dark)),
      `@media (prefers-color-scheme: light){${block(on(":not([data-scheme='dark'])"), colorVars(theme.light))}}`,
      `${on("[data-scheme='light']")}{color-scheme:light}`,
      block(on("[data-scheme='light']"), colorVars(theme.light)),
      `${on("[data-scheme='dark']")}{color-scheme:dark}`,
      block(on("[data-scheme='dark']"), colorVars(theme.dark))
    );
  }
  return [
    block(selector, staticVars(theme)),
    `@media screen{${rules.join('')}}`,
    `@media print{${block(selector, colorVars(PRINT_COLORS))}}`,
  ].join('');
};
