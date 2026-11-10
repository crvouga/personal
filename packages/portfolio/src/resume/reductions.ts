/**
 * Ways to shrink the resume, least painful first. Each returns null when it has
 * nothing left to remove, so the fit loop can fall through to the next.
 *
 * Every role always stays: an unexplained gap costs more than a lost bullet.
 */
import type { Experience, ResumeContent } from './html';

export type Reduce = (content: ResumeContent) => ResumeContent | null;

/** Named so a build can say what it had to drop, and tests can assert on it. */
export type Reduction = {
  readonly name: string;
  readonly apply: Reduce;
};

/** Index of the role with the most bullets above `floor`; ties go to the older. */
const longestRole = (
  experience: readonly Experience[],
  floor: number
): number => {
  let best = -1;
  experience.forEach((role, index) => {
    const longest = experience[best]?.bullets.length ?? floor;
    if (role.bullets.length > floor && role.bullets.length >= longest) {
      best = index;
    }
  });
  return best;
};

const trimBullets =
  (floor: number): Reduce =>
  (content) => {
    const index = longestRole(content.experience, floor);
    if (index === -1) return null;
    return {
      ...content,
      experience: content.experience.map((role, i) =>
        i === index ? { ...role, bullets: role.bullets.slice(0, -1) } : role
      ),
    };
  };

const dropLastProject =
  (keep: number): Reduce =>
  (content) =>
    content.projects.length > keep
      ? { ...content, projects: content.projects.slice(0, -1) }
      : null;

const dropProjectDescriptions: Reduce = (content) =>
  content.projects.some((project) => project.description !== null)
    ? {
        ...content,
        projects: content.projects.map((p) => ({ ...p, description: null })),
      }
    : null;

const dropLastSkillRow: Reduce = (content) =>
  content.skills.length > 3
    ? { ...content, skills: content.skills.slice(0, -1) }
    : null;

const dropSecondSummarySentence: Reduce = (content) =>
  content.summary.length > 1
    ? { ...content, summary: content.summary.slice(0, 1) }
    : null;

const trimCompetencies: Reduce = (content) => {
  const competencies = content.competencies ?? [];
  return competencies.length > 4
    ? { ...content, competencies: competencies.slice(0, -1) }
    : null;
};

export const REDUCTIONS: readonly Reduction[] = [
  { name: 'trim a 4th+ bullet', apply: trimBullets(3) },
  { name: 'drop the last project', apply: dropLastProject(3) },
  {
    name: 'drop the second summary sentence',
    apply: dropSecondSummarySentence,
  },
  { name: 'trim a competency', apply: trimCompetencies },
  { name: 'trim a 3rd bullet', apply: trimBullets(2) },
  { name: 'drop the last skill row', apply: dropLastSkillRow },
  { name: 'drop the last project', apply: dropLastProject(2) },
  { name: 'drop project descriptions', apply: dropProjectDescriptions },
  { name: 'trim a 2nd bullet', apply: trimBullets(1) },
  { name: 'drop the last project', apply: dropLastProject(0) },
];

/** The first reduction that changes anything, or null when none is left. */
export const reduceOnce = (
  content: ResumeContent
): { readonly name: string; readonly content: ResumeContent } | null => {
  for (const reduction of REDUCTIONS) {
    const next = reduction.apply(content);
    if (next !== null) return { name: reduction.name, content: next };
  }
  return null;
};
