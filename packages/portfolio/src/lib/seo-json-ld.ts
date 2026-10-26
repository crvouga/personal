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
    ...new Set(CONTENT.TOOLBOX.primary.flatMap((row) => row.items)),
  ];
  const current = CONTENT.WORK.find((work) => work.end === 'Present');
  return {
    '@type': 'Person',
    name: CONTENT.PAGE_TITLE,
    url: SITE_URL,
    jobTitle: CONTENT.PAGE_SUBTITLE,
    image: seo.image.url,
    // The pitch, exactly as the page, the résumé and /llms.txt state it.
    description: CONTENT.HERO.statement,
    email: `mailto:${CONTENT.EMAIL_ADDRESS}`,
    sameAs: [CONTENT.GITHUB_URL, CONTENT.LINKEDIN_URL, CONTENT.X_URL],
    knowsAbout,
    hasOccupation: {
      '@type': 'Occupation',
      name: CONTENT.PAGE_SUBTITLE,
      skills: knowsAbout.join(', '),
    },
    ...(current === undefined
      ? {}
      : {
          worksFor: {
            '@type': 'Organization',
            name: current.name,
            ...(current.infoUrl === undefined ? {} : { url: current.infoUrl }),
          },
        }),
    ...(school === undefined
      ? {}
      : {
          alumniOf: {
            '@type': 'CollegeOrUniversity',
            name: school.institutionName,
            ...(school.infoUrl === undefined ? {} : { url: school.infoUrl }),
          },
        }),
    address: {
      '@type': 'PostalAddress',
      addressLocality: 'Phoenix',
      addressRegion: 'AZ',
      addressCountry: 'US',
    },
    subjectOf: [
      {
        '@type': 'DigitalDocument',
        name: 'Résumé (PDF)',
        url: `${SITE_URL}/chris-vouga-resume.pdf`,
      },
      {
        '@type': 'Dataset',
        name: 'JSON Resume',
        url: `${SITE_URL}/resume.json`,
      },
    ],
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

const articleNodes = (
  seo: Seo,
  schema: Extract<Seo['schema'], { t: 'article' }>
): Node[] => [
  {
    '@type': 'TechArticle',
    headline: seo.title,
    description: seo.description,
    url: absoluteUrl(seo.path),
    image: seo.image.url,
    author: { '@type': 'Person', name: CONTENT.PAGE_TITLE, url: SITE_URL },
    ...(schema.codeRepository === undefined
      ? {}
      : {
          about: {
            '@type': 'SoftwareSourceCode',
            codeRepository: schema.codeRepository,
          },
        }),
  },
  {
    '@type': 'BreadcrumbList',
    itemListElement: schema.breadcrumb.map((crumb, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: crumb.name,
      item: absoluteUrl(crumb.path),
    })),
  },
];

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
    case 'article':
      return graph([...articleNodes(seo, seo.schema), webSiteNode()]);
    case 'none':
      return null;
  }
};
