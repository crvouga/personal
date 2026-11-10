/**
 * Each role's look and feel, as a design-system theme
 * (`src/design-system/`), derived from the `visual` section of its research
 * research (`src/market/research/<id>.json`): what its readers respond to, with
 * the sources that say so. A role file's `look` may depart from the research,
 * with a reason. `themeFromBrief` solves every colour for WCAG AA, and
 * `src/design-system/themes.test.ts` checks the result.
 *
 * A theme changes colour, typefaces and corners; it never changes structure,
 * so every component and every accessibility check holds for all of them.
 */
import { themeCss } from '../design-system/css';
import { themeFromBrief } from '../design-system/palette';
import type { Theme } from '../design-system/tokens';
import { researchFor } from '../market/research';
import { ROLE_DEFINITIONS } from './by-id/index';
import { visualStyleOf } from './style';
import { ROLE_IDS, DEFAULT_ROLE_ID, type RoleId } from './definitions';

export type { Theme };
export { visualStyleOf };

const sentence = (text: string): string =>
  `${text.charAt(0).toUpperCase()}${text.slice(1)}.`;

export const THEMES: Readonly<Record<RoleId, Theme>> = Object.fromEntries(
  ROLE_DEFINITIONS.map((role) => {
    const { visual } = researchFor(role.id);
    return [
      role.id,
      themeFromBrief(
        role.id,
        `${sentence(visual.tone)} ${visual.rationale}`,
        visualStyleOf(visual, role.style)
      ),
    ];
  })
) as Record<RoleId, Theme>;

/** The page default, applied at `:root` before any `data-theme`. */
export const DEFAULT_THEME_CSS: string = themeCss(
  THEMES[DEFAULT_ROLE_ID],
  ':root'
);

/**
 * Every theme at once, for the pages that are not built per role
 * (`/projects/`, case studies): they carry all of them and a script names
 * the one the visitor arrived with on `<html data-theme>`.
 */
export const ALL_THEMES_CSS: string = ROLE_IDS.map((id) =>
  themeCss(THEMES[id])
).join('');
