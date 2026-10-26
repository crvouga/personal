/**
 * One skill profile for every surface: the Toolbox, the résumé's Skills,
 * `/resume.json` and the JSON-LD `knowsAbout` all read SKILL_PROFILE, so a
 * reviewer comparing the site with the PDF sees the same person. Everything
 * else any project used is listed once, folded, as "Also shipped with".
 */
import { CONTENT } from '../content/content';
import type { SkillRow } from '../content/skills';
import { buildSkills } from '../resume/content';

export const SKILL_PROFILE: readonly SkillRow[] = buildSkills();

const profiled = new Set(SKILL_PROFILE.flatMap((row) => row.items));

export const ALSO_SHIPPED_WITH: readonly string[] = CONTENT.SKILL_ROWS.flatMap(
  (row) => row.items
).filter((item) => !profiled.has(item));

export const KNOWS_ABOUT: readonly string[] = [...profiled];
