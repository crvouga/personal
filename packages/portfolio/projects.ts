/**
 * The site's project registry: each fact in the knowledge base
 * (`src/knowledge/projects.ts`) joined with its media
 * (`src/content/projects/media.ts`).
 *
 *   PROJECTS[] feeds the website, resume, and screenshots.
 *   Runtime hosting for side projects lives in packages/infra/tofu/modules/inventory/inventory.tf.json.
 *
 * Adding a hosted side project:
 *   - Add the service in packages/infra/tofu/modules/inventory/inventory.tf.json and its project repo.
 *   - Append a fact to `PROJECT_FACTS` in src/knowledge/projects.ts (title,
 *     description, `deployment.url`, topics, themes).
 *   - Add its screenshots under the same id in src/content/projects/media.ts.
 */
import { ARCHIVE_PROJECT_FACTS } from './src/knowledge/projects-archive';
import { PROJECT_FACTS } from './src/knowledge/projects';
import type { ProjectFact } from './src/knowledge/types';
import { ARCHIVE_PROJECT_MEDIA } from './src/content/projects/media-archive';
import { PROJECT_MEDIA } from './src/content/projects/media';
import type { Project, ProjectMedia } from './src/content/projects/types';

export type {
  Code,
  Deployment,
  Project,
  ResumePolicy,
} from './src/content/projects/types';

export const projectToLinkHref = (project: Project): string | null => {
  if (project.deployment.t === 'public') return project.deployment.url;
  if (project.code.t === 'public') return project.code.url;
  return null;
};

const NO_MEDIA: ProjectMedia = {
  imageSrc: [],
  imageAlt: '',
  galleryImageSrc: [],
};

const join =
  (media: Readonly<Record<string, ProjectMedia>>) =>
  (fact: ProjectFact): Project => ({
    ...fact,
    topics: [...fact.topics],
    ...(media[fact.id] ?? NO_MEDIA),
  });

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

export const PROJECTS: readonly Project[] = PROJECT_FACTS.map(
  join(PROJECT_MEDIA)
);

/**
 * Early and small work, kept out of `PROJECTS` so it never dilutes the curated
 * listing, the Toolbox, the screenshot jobs or the resume. `/projects/` renders
 * it behind a fold so nothing built is ever actually lost.
 */
export const ARCHIVE_PROJECTS: readonly Project[] = ARCHIVE_PROJECT_FACTS.map(
  join(ARCHIVE_PROJECT_MEDIA)
);
