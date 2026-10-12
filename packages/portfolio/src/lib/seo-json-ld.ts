import { CONTENT } from '../content/content';
import { SITE_TITLE, SITE_URL, absoluteUrl } from './seo';
import type { Seo } from './seo-types';

type Node = Record<string, unknown>;

/**
 * Kept as small named builders rather than one literal: `max-lines-per-function`
 * is 70 and the graph grows every time a node type is added.
 */
const personNode = (seo: Seo): Node => {
  const school = CONTENT.SCHOOL[0];
  const knowsAbout = [
    ...new Set(CONTENT.SKILL_ROWS.flatMap((row) => row.items)),
  ];
  return {
    '@type': 'Person',
    name: CONTENT.PAGE_TITLE,
    url: SITE_URL,
    jobTitle: CONTENT.PAGE_SUBTITLE,
    image: seo.image.url,
    description: seo.description,
    sameAs: [CONTENT.GITHUB_URL, CONTENT.LINKEDIN_URL, CONTENT.X_URL],
    knowsAbout,
    alumniOf:
      school === undefined
        ? undefined
        : { '@type': 'CollegeOrUniversity', name: school.institutionName },
    address: {
      '@type': 'PostalAddress',
      addressRegion: 'AZ',
      addressCountry: 'US',
    },
  };
};

const webSiteNode = (): Node => ({
  '@type': 'WebSite',
  url: `${SITE_URL}/`,
  name: SITE_TITLE,
});

const collectionNode = (seo: Seo): Node => ({
  '@type': 'CollectionPage',
  name: seo.title,
  description: seo.description,
  url: absoluteUrl(seo.path),
});

const graph = (nodes: readonly Node[]): Node => ({
  '@context': 'https://schema.org',
  '@graph': nodes,
});

/** `null` means the page emits no ld+json block at all. */
export const buildJsonLd = (seo: Seo): Node | null => {
  switch (seo.schema.t) {
    case 'home':
      return graph([personNode(seo), webSiteNode()]);
    case 'collection':
      return graph([collectionNode(seo), webSiteNode()]);
    case 'none':
      return null;
  }
};
