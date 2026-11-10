/**
 * A market research's `visual` section in the design system's terms, with a
 * role file's departures applied. Kept apart from `theme.ts` so the
 * generator can use it without loading the role files.
 */
import type { VisualStyle } from '../design-system/palette';
import type { Visual } from '../market/schema';

/** The research's look in the design system's terms. */
export const visualStyleOf = (
  visual: Visual,
  style: Partial<VisualStyle> = {}
): VisualStyle => ({
  // A dark-only page fails readers in daylight; dark becomes "follows them".
  scheme: visual.scheme === 'light' ? 'light' : 'auto',
  hue: visual.hue,
  chroma: visual.chroma,
  display: visual.display,
  accent: visual.accent,
  corners: visual.corners,
  ...style,
});
