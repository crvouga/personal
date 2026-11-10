/**
 * The personal knowledge base: everything true about Chris, as data, with
 * nothing about how it is shown. The market knowledge base (`src/market/`)
 * is the other input; presentations, résumés and the gap analysis are
 * functions of the two.
 */
import { BIO } from './bio';
import { CAPABILITIES, CAPABLE_SKILLS, KNOWN_TOPICS } from './capabilities';
import { EDUCATION } from './education';
import { IDENTITY, LOGISTICS } from './identity';
import { PROJECT_FACTS } from './projects';
import { JOBS } from './jobs';
import type { Theme } from './themes';

/** One piece of evidence: an achievement in a role, or a listed project. */
export type Fact = {
  readonly id: string;
  readonly kind: 'achievement' | 'project';
  /** Where it happened: the employer, or "side project". */
  readonly where: string;
  readonly title: string;
  /** Plain text, links reduced to their labels. */
  readonly text: string;
  readonly themes: readonly Theme[];
  readonly topics: readonly string[];
  /** Done in a paid role, not on the side. */
  readonly professional: boolean;
};

const plain = (text: string): string =>
  text.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/\*\*/g, '');

const ACHIEVEMENTS: readonly Fact[] = JOBS.flatMap((job) =>
  job.achievements.map((achievement) => ({
    id: achievement.id,
    kind: 'achievement' as const,
    where: job.employer,
    title: `${job.title}, ${job.employer}`,
    text: plain(achievement.text),
    themes: achievement.themes,
    topics: achievement.topics,
    professional: true,
  }))
);

const PROJECTS: readonly Fact[] = PROJECT_FACTS.map((project) => ({
  id: project.id,
  kind: 'project' as const,
  where: project.setting === 'work' ? 'work project' : 'side project',
  title: project.title,
  text: plain(project.description),
  themes: project.themes,
  topics: project.topics,
  professional: project.setting === 'work',
}));

/** Whole years since the first role began. */
const yearsSince = (year: number, now: Date): number =>
  now.getFullYear() - year;

export const PERSONAL = {
  identity: IDENTITY,
  logistics: LOGISTICS,
  bio: BIO,
  education: EDUCATION,
  jobs: JOBS,
  projects: PROJECT_FACTS,
  capabilities: CAPABILITIES,
  /** Every achievement and listed project, as one list of evidence. */
  facts: [...ACHIEVEMENTS, ...PROJECTS] as readonly Fact[],
  /** Market skill ids the knowledge base can back. */
  skills: CAPABLE_SKILLS,
  topics: KNOWN_TOPICS,
} as const;

export const yearsOfExperience = (now: Date = new Date()): number =>
  yearsSince(Math.min(...JOBS.map((job) => job.start.year)), now);
