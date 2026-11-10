import { DEFAULT_DEMAND, type Demand } from '../roles/demand';
import { rankBy } from '../roles/rank';
import { JOBS, JOB_GAP_NOTE } from '../knowledge/jobs';
import { toHtml } from '../knowledge/text';
import type { YearMonth as KnowledgeYearMonth } from '../knowledge/types';
import { a } from './a';
import type { Topic } from './topic';

/** A role boundary; see `knowledge/types.ts`. */
export type YearMonth = KnowledgeYearMonth;

export type Work = {
  /** The knowledge-base role this card renders. */
  id: string;
  name: string;
  infoUrl?: string;
  jobTitle: string;
  /**
   * Scannable bullets; the site cards and the resume both render these.
   * Senior roles: each one carries a number or a link to the named artifact
   * (`src/content/copy.test.ts`), because a bullet a reviewer cannot check is a
   * bullet they skip.
   */
  highlights: string[];
  start: YearMonth;
  end: YearMonth | 'Present';
  /**
   * Recognition rendered as text. Award images alone are invisible to crawlers,
   * to LLM candidate research, and to anyone who does not open a gallery.
   */
  awards?: string[];
  /**
   * The role's stack, for the Toolbox and the résumé's Skills. Client work is
   * also told through PROJECTS, whose topics count too; this is for a role
   * whose product is not a portfolio project.
   */
  topics?: Topic[];
  imageSrc: string[];
  imageAlt: string;
  galleryImageSrc: string[];
};

type WorkMedia = Pick<Work, 'imageSrc' | 'imageAlt' | 'galleryImageSrc'>;

/** The site's media for each role in the knowledge base, keyed by role id. */
const WORK_MEDIA: Readonly<Record<string, WorkMedia>> = {
  geviti: {
    imageSrc: ['/geviti-app-screenshot.optimized.webp'],
    imageAlt:
      'Geviti member app sign-in: the complete picture of your health, from bloodwork, genetics and gut health',
    galleryImageSrc: ['/geviti-app-screenshot.optimized.webp'],
  },
  'one-origin': {
    imageSrc: [
      '/one-origin-screenshot.optimized.webp',
      '/one-origin/2025-q1-award-1.optimized.webp',
    ],
    imageAlt: 'One Origin website and quarterly recognition award certificates',
    galleryImageSrc: [
      '/one-origin-screenshot.optimized.webp',
      '/one-origin/2025-q1-award-1.optimized.webp',
      '/one-origin/2024-q3-&-q4-award-1.optimized.webp',
      '/one-origin/2024-q2-award-1.optimized.webp',
      '/one-origin/2024-q1-award-1.optimized.webp',
      '/one-origin/desk.optimized.webp',
    ],
  },
  freelancing: {
    imageSrc: [],
    imageAlt: '',
    galleryImageSrc: [],
  },
};

const NO_MEDIA: WorkMedia = { imageSrc: [], imageAlt: '', galleryImageSrc: [] };

/** A knowledge-base fact as the site's HTML: links become inline anchors. */
export const factHtml = (text: string): string => toHtml(text, a);

/**
 * The roles in `src/knowledge/jobs.ts`, as the site renders them for one
 * audience: roles stay in date order, and inside each role the achievements
 * that audience's postings ask for most come first. Nothing is dropped.
 */
export const buildWork = (demand: Demand): Work[] =>
  JOBS.map((job) => ({
    id: job.id,
    name: job.employer,
    ...(job.employerUrl === undefined ? {} : { infoUrl: job.employerUrl }),
    jobTitle: job.title,
    highlights: rankBy(job.achievements, demand, (fact) => fact).map(
      (achievement) => factHtml(achievement.text)
    ),
    start: job.start,
    end: job.end,
    ...(job.awards === undefined ? {} : { awards: [...job.awards] }),
    ...(job.topics === undefined ? {} : { topics: [...job.topics] }),
    ...(WORK_MEDIA[job.id] ?? NO_MEDIA),
  }));

/** The default presentation's roles; every machine-readable surface uses it. */
export const WORK: Work[] = buildWork(DEFAULT_DEMAND);

/** One honest line about the time between the last two roles; see roles.ts. */
export const WORK_GAP_NOTE: string | undefined = JOB_GAP_NOTE;

/** The role the hero and résumé headline describe. */
export const CURRENT_WORK: Work | undefined = WORK.find(
  (job) => job.end === 'Present'
);
