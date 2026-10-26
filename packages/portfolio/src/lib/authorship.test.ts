import { describe, expect, test } from 'bun:test';

import { ARCHIVE_PROJECTS, PROJECTS } from '../content/project';
import { PROJECT_HISTORY } from '../content/projects/history';
import {
  authorshipOf,
  isHandWrittenYear,
  medianCommitYear,
} from './authorship';

const ALL_PROJECTS = [...PROJECTS, ...ARCHIVE_PROJECTS];

const isHandWritten = (id: string): boolean => {
  const project = ALL_PROJECTS.find((p) => p.id === id);
  if (project === undefined) throw new Error(`No project ${id}`);
  return authorshipOf(project) !== null;
};

describe('medianCommitYear', () => {
  test('is the year half of the commits had landed by', () => {
    expect(medianCommitYear({ 2022: 10, 2023: 10, 2026: 5 })).toBe(2023);
    expect(medianCommitYear({ 2026: 977 })).toBe(2026);
  });

  test('late maintenance commits do not move an old project forward', () => {
    expect(medianCommitYear({ 2020: 22, 2021: 12, 2025: 2, 2026: 3 })).toBe(
      2020
    );
  });

  test('a rewrite larger than the original does', () => {
    expect(medianCommitYear({ 2021: 100, 2026: 400 })).toBe(2026);
  });

  test('is null without commits', () => {
    expect(medianCommitYear({})).toBeNull();
  });
});

describe('isHandWrittenYear', () => {
  test('anything before 2026 is hand-written', () => {
    expect(isHandWrittenYear(2024)).toBe(true);
    expect(isHandWrittenYear(2025)).toBe(true);
    expect(isHandWrittenYear(2026)).toBe(false);
  });
});

describe('project authorship', () => {
  // A project with no entry silently renders without a badge, which is only
  // right for agent-era work; make the omission a decision instead.
  test('every project has recorded history, and nothing else does', () => {
    expect(Object.keys(PROJECT_HISTORY).sort()).toEqual(
      ALL_PROJECTS.map((p) => p.id).sort()
    );
  });

  // The homepage leads with agent-era work, where the method is the point;
  // a hand-written flagship may follow, and its badge says so.
  test('the homepage leads with agent-era work', () => {
    expect(isHandWritten('mockingbird')).toBe(false);
    expect(isHandWritten('workspace-platform')).toBe(false);
    expect(isHandWritten('gamezilla')).toBe(false);
  });

  test('historical projects respect the owner’s label choices', () => {
    expect(isHandWritten('asu-earned-admissions')).toBe(true);
    expect(isHandWritten('normalizer-app')).toBe(false);
    expect(isHandWritten('headless-combobox')).toBe(true);
  });

  test('the badge states its evidence', () => {
    const project = ALL_PROJECTS.find((p) => p.id === 'headless-combobox');
    expect(project && authorshipOf(project)?.title).toBe(
      'Written by hand, before AI coding agents: half of its commits had landed by 2023.'
    );
  });
});
