import { caseStudyFor } from '../content/case-studies';
import { CONTENT } from '../content/content';
import type { Project } from '../content/project';

/** Homepage cards; the rest of the registry is one click away on /projects/. */
export const VISIBLE_PROJECT_COUNT = 3;

const YOUTUBE_EMBED = /^https?:\/\/(www\.)?youtube(-nocookie)?\.com\/embed\//;

/** Cover plus gallery entries; the media a card can open. */
const mediaCount = (project: Project): number =>
  project.imageSrc.length + project.galleryImageSrc.length;

/**
 * A card has to lead somewhere. Usually that is a live site or a repository,
 * but client work under NDA earns its place on its gallery alone — the
 * screenshots and demo video are the destination, and dropping those projects
 * hid the largest systems in the portfolio.
 */
export const isListed = (project: Project): boolean =>
  project.deployment.t === 'public' ||
  project.code.t === 'public' ||
  mediaCount(project) > 0;

export const LISTED_PROJECTS: readonly Project[] =
  CONTENT.PROJECTS.filter(isListed);

/**
 * A homepage flagship is a work sample, so a reviewer has to be able to open
 * it: public source, or a case study that explains what cannot be shown.
 */
export const isReviewable = (project: Project): boolean =>
  project.code.t === 'public' || caseStudyFor(project.id) !== undefined;

/** The first reviewable projects, in registry order. */
export const VISIBLE_PROJECTS: readonly Project[] = LISTED_PROJECTS.filter(
  isReviewable
).slice(0, VISIBLE_PROJECT_COUNT);

/** Live site if deployed, else the repository — never a dead link. */
export const projectHref = (project: Project): string | null =>
  project.deployment.t === 'public'
    ? project.deployment.url
    : project.code.t === 'public'
      ? project.code.url
      : null;

/**
 * Why a card carries no outbound link. Without this a link-less card reads as
 * broken rather than as private work.
 */
export const accessNote = (project: Project): string | null => {
  // A live product with closed source: say so, or a missing Code link reads
  // as an oversight.
  if (project.deployment.t === 'public' && project.code.t === 'private') {
    return project.setting === 'work' ? 'Client code' : 'Source private';
  }
  if (projectHref(project) !== null) return null;
  switch (project.deployment.t) {
    case 'not-deployed-anymore':
      return 'No longer hosted';
    case 'not-deployed-yet':
      return 'Not yet deployed';
    default:
      return 'Private deployment';
  }
};

export type GalleryItem =
  | { readonly kind: 'image'; readonly src: string; readonly alt: string }
  | { readonly kind: 'video'; readonly src: string };

/**
 * YouTube embeds become video slides; everything else is an image. Sources are
 * de-duplicated because covers are usually repeated inside `galleryImageSrc`,
 * which otherwise shows the same slide twice.
 */
export const toGalleryItems = (
  sources: readonly string[],
  label: string,
  coverAlt?: string
): GalleryItem[] => {
  const unique = [...new Set(sources)];
  return unique.map((src, index) => {
    if (YOUTUBE_EMBED.test(src)) return { kind: 'video' as const, src };
    // The cover is described; the rest are numbered, so a screen-reader user
    // still knows where they are in the set.
    const alt =
      index === 0 && coverAlt !== undefined && coverAlt !== ''
        ? coverAlt
        : `${label}, image ${String(index + 1)} of ${String(unique.length)}`;
    return { kind: 'image' as const, src, alt };
  });
};

/** Cover first, then gallery entries. */
export const galleryFor = (project: Project): GalleryItem[] =>
  toGalleryItems(
    [...project.imageSrc, ...project.galleryImageSrc],
    project.title,
    project.imageAlt
  );

/** Gallery payload for the dialog, indexed by card position. */
export const VISIBLE_GALLERIES: readonly (readonly GalleryItem[])[] =
  VISIBLE_PROJECTS.map(galleryFor);

/**
 * The one source for every project count the site prints, so the homepage
 * link and `/projects/` cannot disagree (they once said 17 and 26).
 */
export const PROJECT_TOTALS = {
  listed: LISTED_PROJECTS.length,
  archived: CONTENT.ARCHIVE_PROJECTS.length,
} as const;
