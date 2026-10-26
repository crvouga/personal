/** Absolute URL plus the dimensions social cards need up front. */
export type SeoImage = {
  readonly url: string;
  readonly alt: string;
  readonly width: number;
  readonly height: number;
  /** MIME type; crawlers that cannot sniff it skip the image. */
  readonly type: string;
};

/**
 * Which JSON-LD graph a page emits. The homepage keeps its exact
 * Person + WebSite `@graph`.
 */
export type SeoSchema =
  | { readonly t: 'home' }
  | { readonly t: 'collection' }
  /** A case study or post: an Article under Home › Projects › it. */
  | {
      readonly t: 'article';
      readonly breadcrumb: readonly {
        readonly name: string;
        readonly path: string;
      }[];
      readonly codeRepository?: string;
    }
  | { readonly t: 'none' };

export type Seo = {
  /** The full <title>; never suffixed automatically. */
  readonly title: string;
  readonly description: string;
  /**
   * Canonical path with a leading and trailing slash: `/`, `/projects/`.
   * It must match what the sitemap emits, or every page
   * self-reports a canonical that disagrees with its own sitemap entry.
   */
  readonly path: string;
  readonly image: SeoImage;
  readonly schema: SeoSchema;
  /** Only /404 sets this. */
  readonly noindex?: boolean;
};
