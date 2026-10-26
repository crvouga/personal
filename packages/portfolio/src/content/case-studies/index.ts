import { GAMEZILLA_CASE_STUDY } from './gamezilla';
import { MOCKINGBIRD_CASE_STUDY } from './mockingbird';
import type { CaseStudy } from './types';
import { WORKSPACE_CASE_STUDY } from './workspace-platform';

export type { CaseStudy } from './types';
export { CASE_STUDY_SECTIONS } from './types';

/**
 * Projects with a case study get a page at `/projects/<slug>/`. Triangulator's
 * is waiting on facts only Chris has (CONTENT_QUESTIONS.md); writing it from
 * screenshots would be guessing.
 */
export const CASE_STUDIES: readonly CaseStudy[] = [
  MOCKINGBIRD_CASE_STUDY,
  GAMEZILLA_CASE_STUDY,
  WORKSPACE_CASE_STUDY,
];

export const caseStudyFor = (projectId: string): CaseStudy | undefined =>
  CASE_STUDIES.find((study) => study.projectId === projectId);

export const caseStudyHref = (study: CaseStudy): string =>
  `/projects/${study.slug}/`;
