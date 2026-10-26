import { describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { outcomeFactsFor } from '../../lib/case-study-view';
import { VISIBLE_PROJECTS } from '../../lib/projects-view';
import { PROJECTS } from '../project';
import { CASE_STUDIES, CASE_STUDY_SECTIONS, type CaseStudy } from '.';

/** The standard format, enforced: a reviewer compares flagships side by side. */
const MIN_WORDS = 350;
const MAX_WORDS = 600;

const prose = (study: CaseStudy): string[] =>
  CASE_STUDY_SECTIONS.flatMap(([key]) => [...study[key]]);

const words = (study: CaseStudy): number =>
  prose(study).join(' ').split(/\s+/).filter(Boolean).length;

describe.each(CASE_STUDIES.map((study) => [study.slug, study] as const))(
  'case study %s',
  (_slug, study) => {
    test('tells an existing project', () => {
      expect(PROJECTS.some((p) => p.id === study.projectId)).toBe(true);
    });

    test('has every section of the standard format', () => {
      for (const [key] of CASE_STUDY_SECTIONS) {
        expect(study[key].length).toBeGreaterThan(0);
      }
    });

    test(`is ${String(MIN_WORDS)}–${String(MAX_WORDS)} words`, () => {
      expect(words(study)).toBeGreaterThanOrEqual(MIN_WORDS);
      expect(words(study)).toBeLessThanOrEqual(MAX_WORDS);
    });

    // Outcome figures are rendered from the snapshots; prose that typed one
    // would drift the day after it was written.
    test('types no numbers; its outcome figures are derived', () => {
      expect(prose(study).filter((p) => /\d/.test(p))).toEqual([]);
      expect(outcomeFactsFor(study.projectId).length).toBeGreaterThan(3);
    });

    test('ships its hero image and links only to https', () => {
      expect(
        existsSync(join(import.meta.dir, '../../../public', study.hero.src))
      ).toBe(true);
      expect(study.hero.alt.length).toBeGreaterThan(20);
      expect(study.links.filter((l) => !l.href.startsWith('https://'))).toEqual(
        []
      );
    });

    test('fits a search snippet', () => {
      expect(study.description.length).toBeLessThanOrEqual(160);
    });
  }
);

describe('homepage flagships', () => {
  test('are exactly three, each with public code or a case study', () => {
    expect(VISIBLE_PROJECTS).toHaveLength(3);
    const unreviewable = VISIBLE_PROJECTS.filter(
      (p) =>
        p.code.t !== 'public' && !CASE_STUDIES.some((s) => s.projectId === p.id)
    ).map((p) => p.id);
    expect(unreviewable).toEqual([]);
  });

  test('no employer product is listed as a personal project', () => {
    // Employer products are listed, but as work, grouped apart on /projects/.
    const employers = new Set([
      'geviti-app',
      'triangulator',
      'study-hall',
      'orchard',
    ]);
    expect(
      PROJECTS.filter((p) => employers.has(p.id) && p.setting !== 'work').map(
        (p) => p.id
      )
    ).toEqual([]);
  });
});
