import type { Project } from '../content/project';
import {
  PROJECT_HISTORY,
  type ProjectHistory,
} from '../content/projects/history';

/**
 * Coding agents wrote most of my code from 2026 on, so the year a project was
 * written says who typed it.
 */
const HAND_WRITTEN_BEFORE = 2026;

/**
 * The year by which half of the commits had landed. A median rather than the
 * first commit, so a 2021 project rewritten in 2026 is dated by where the
 * work actually sits, and a handful of late maintenance commits cannot move
 * an old project forward.
 */
export const medianCommitYear = (
  byYear: Readonly<Record<number, number>>
): number | null => {
  const years = Object.keys(byYear)
    .map(Number)
    .sort((a, b) => a - b);
  const total = years.reduce((sum, year) => sum + (byYear[year] ?? 0), 0);
  let seen = 0;
  for (const year of years) {
    seen += byYear[year] ?? 0;
    if (total > 0 && seen * 2 >= total) return year;
  }
  return null;
};

/** The year the bulk of the project was written; null without history. */
export const writtenYear = (history: ProjectHistory): number | null =>
  history.t === 'commits' ? medianCommitYear(history.byYear) : history.year;

export const isHandWrittenYear = (year: number): boolean =>
  year < HAND_WRITTEN_BEFORE;

export type AuthorshipBadge = {
  readonly label: string;
  /** Tooltip: the evidence, so the badge is a claim a reader can check. */
  readonly title: string;
};

/** Null for agent-era work and for projects with no recorded history. */
export const authorshipOf = (project: Project): AuthorshipBadge | null => {
  const history = PROJECT_HISTORY[project.id];
  if (history === undefined) return null;
  const year = writtenYear(history);
  if (year === null || !isHandWrittenYear(year)) return null;
  const evidence =
    history.t === 'commits'
      ? `half of its commits had landed by ${String(year)}`
      : `it had shipped by ${String(year)}`;
  return {
    label: 'Hand-written',
    title: `Written by hand, before AI coding agents: ${evidence}.`,
  };
};
