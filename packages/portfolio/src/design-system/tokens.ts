/**
 * The design system's tokens: everything a theme may change. Components never
 * hard-code a colour, typeface or corner; they read these as CSS custom
 * properties (`--bg`, `--font-accent`, `--radius-md`, …), so a theme injected
 * anywhere on the page restyles everything below it.
 *
 * Spacing, type sizes and motion are fixed in `global.css`: a theme changes the
 * look, never the layout, so every accessibility check holds for all of them.
 */

/** A colour scheme's palette. Every text/background pair is held to WCAG AA. */
export type ColorTokens = {
  readonly bg: string;
  readonly paper: string;
  readonly paperBorder: string;
  readonly paperBorderHover: string;
  readonly text: string;
  readonly textMuted: string;
  readonly textSubtle: string;
  readonly accent: string;
  readonly accentHover: string;
  readonly accentStrong: string;
  /** Primary-button fill; `onAccent` must hold 4.5:1 on it. */
  readonly accentDeep: string;
  readonly accentDeepHover: string;
  readonly accentSoft: string;
  readonly accentGlow: string;
  readonly onAccent: string;
  readonly success: string;
  readonly navBg: string;
  readonly scrim: string;
  readonly handwrittenTextA: string;
  readonly handwrittenTextB: string;
  /** Contribution heatmap ramp: a quiet zero, then four even steps. */
  readonly heat: readonly [string, string, string, string, string];
};

export type FontRole = 'sans' | 'mono' | 'serif';

export type TypographyTokens = {
  /** Running text. */
  readonly body: FontRole;
  /** Labels, eyebrows, section headings, metadata: the site's accent face. */
  readonly accent: FontRole;
  /** Page and card headings (`h1`–`h3`). */
  readonly display: FontRole;
  readonly displayWeight: number;
  /** Letter spacing of headings, e.g. `0` or `-0.01em`. */
  readonly displayTracking: string;
  /** Show the `01`, `02` numbers before section headings. */
  readonly sectionNumbers: boolean;
};

export type ShapeTokens = {
  readonly radiusSm: string;
  readonly radiusMd: string;
  readonly radiusLg: string;
};

export type Theme = {
  readonly id: string;
  /** One line on the look and who it is for; shown in Storybook. */
  readonly description: string;
  /** `auto` follows the visitor's colour scheme; `light` is always light. */
  readonly scheme: 'auto' | 'light';
  readonly dark: ColorTokens;
  readonly light: ColorTokens;
  readonly typography: TypographyTokens;
  readonly shape: ShapeTokens;
  /** Accent for the résumé PDF, which is always printed on white. */
  readonly resumeAccent: string;
};

export const FONT_STACKS: Readonly<Record<FontRole, string>> = {
  sans: "'Inter Variable', -apple-system, 'system-ui', 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
  mono: "'JetBrains Mono Variable', 'SF Mono', 'Menlo', 'Consolas', 'Liberation Mono', monospace",
  serif:
    "'Iowan Old Style', 'Palatino Linotype', Palatino, Georgia, 'Times New Roman', serif",
};
