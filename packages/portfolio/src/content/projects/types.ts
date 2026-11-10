import type {
  Code as KnowledgeCode,
  Deployment as KnowledgeDeployment,
  ProjectFact,
} from '../../knowledge/types';
import type { Topic } from '../topic';

export type Code = KnowledgeCode;
export type Deployment = KnowledgeDeployment;

/**
 * Resume curation. The resume lists the homepage's featured side projects in
 * homepage order; `include: false` keeps one off it.
 */
export type ResumePolicy = {
  readonly include?: boolean;
};

/** What the site adds to a project fact: its screenshots and curation. */
export type ProjectMedia = {
  readonly imageSrc: string[];
  readonly imageAlt: string;
  readonly galleryImageSrc: string[];
  readonly youTubeVideoId?: string;
  /** Optional overrides for resume rendering. */
  readonly resume?: ResumePolicy;
};

/** A knowledge-base project fact joined with the site's media for it. */
export type Project = Omit<ProjectFact, 'topics'> &
  ProjectMedia & { readonly topics: Topic[] };
