import { CONTENT } from '../content/content';
import type { CaseStudy } from '../content/case-studies';
import {
  CARD_HEIGHT,
  CARD_WIDTH,
  buildCardContent,
  buildCaseStudyCardContent,
  cardVersion,
} from '../social/card';
import type { Seo, SeoImage } from './seo-types';

export const SITE_URL = CONTENT.SITE_URL;

export const SITE_NAME = CONTENT.PAGE_TITLE;

export const SITE_TITLE = `${SITE_NAME} — ${CONTENT.PAGE_SUBTITLE}`;

/** `https://x.com/handle` → `@handle`, the form `twitter:creator` expects. */
export const X_HANDLE = `@${new URL(CONTENT.X_URL).pathname.slice(1)}`;

/**
 * The hero pitch, whole. It used to be the About copy cut at a character count,
 * which ended search snippets and link previews mid-word.
 */
export const SITE_DESCRIPTION = CONTENT.HERO.statement;

/**
 * `@astrojs/sitemap` emits trailing-slash URLs under `build.format: 'directory'`,
 * so canonicals have to agree with it.
 */
export const withTrailingSlash = (path: string): string =>
  path.endsWith('/') ? path : `${path}/`;

export const absoluteUrl = (path: string): string =>
  `${SITE_URL}${withTrailingSlash(path)}`;

/**
 * The homepage capture written by the screenshot job. It was the share image
 * until the generated card replaced it; the prune script still reads this so
 * the job's output is not reported as an orphan.
 */
export const HOMEPAGE_SCREENSHOT_PATH = '/main-site-screenshot.optimized.webp';

/** Served by `src/pages/og.png.ts`. */
export const OG_IMAGE_PATH = '/og.png';

/** Served by `src/pages/apple-touch-icon.png.ts`. */
export const TOUCH_ICON_PATH = '/apple-touch-icon.png';

/**
 * Site-wide card, used by any page that has not generated its own. The query
 * string is the card's content hash: a changed card is a new URL, so neither
 * the year-long image cache nor a platform's own copy can serve an old one.
 */
export const DEFAULT_OG_IMAGE: SeoImage = {
  url: `${SITE_URL}${OG_IMAGE_PATH}?v=${cardVersion(buildCardContent())}`,
  alt: `${SITE_TITLE}. ${SITE_DESCRIPTION}`,
  width: CARD_WIDTH,
  height: CARD_HEIGHT,
  type: 'image/png',
};

export const HOME_SEO: Seo = {
  title: SITE_TITLE,
  description: SITE_DESCRIPTION,
  path: '/',
  image: DEFAULT_OG_IMAGE,
  schema: { t: 'home' },
};

export type IndexSeoInput = {
  readonly title: string;
  readonly description: string;
  readonly path: string;
  readonly image?: SeoImage | undefined;
};

/** A listing page: /projects/. */
export const seoForIndex = (input: IndexSeoInput): Seo => ({
  title: input.title,
  description: input.description,
  path: input.path,
  image: input.image ?? DEFAULT_OG_IMAGE,
  schema: { t: 'collection' },
});

export const seoForNotFound = (): Seo => ({
  title: `Page not found — ${SITE_TITLE}`,
  description: 'That page does not exist.',
  path: '/404/',
  image: DEFAULT_OG_IMAGE,
  schema: { t: 'none' },
  noindex: true,
});

/** A case study: its own card, title and description, and an Article graph. */
export const seoForCaseStudy = (
  study: CaseStudy,
  codeRepository?: string
): Seo => ({
  title: `${study.title} — ${SITE_NAME}`,
  description: study.description,
  path: `/projects/${study.slug}/`,
  image: {
    url: `${SITE_URL}/og/${study.slug}.png?v=${cardVersion(buildCaseStudyCardContent(study))}`,
    alt: `${study.title}. ${study.subline}`,
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
    type: 'image/png',
  },
  schema: {
    t: 'article',
    breadcrumb: [
      { name: 'Home', path: '/' },
      { name: 'Projects', path: '/projects/' },
      { name: study.title, path: `/projects/${study.slug}/` },
    ],
    ...(codeRepository === undefined ? {} : { codeRepository }),
  },
});

/** A published post: its own card, and an Article under Home › Writing. */
export const seoForPost = (post: {
  readonly slug: string;
  readonly title: string;
  readonly description: string;
}): Seo => ({
  title: `${post.title} — ${SITE_NAME}`,
  description: post.description,
  path: `/writing/${post.slug}/`,
  image: {
    url: `${SITE_URL}/og/writing-${post.slug}.png?v=${cardVersion(buildCaseStudyCardContent({ title: post.title, subline: post.description }))}`,
    alt: `${post.title}. ${post.description}`,
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
    type: 'image/png',
  },
  schema: {
    t: 'article',
    breadcrumb: [
      { name: 'Home', path: '/' },
      { name: 'Writing', path: '/writing/' },
      { name: post.title, path: `/writing/${post.slug}/` },
    ],
  },
});
