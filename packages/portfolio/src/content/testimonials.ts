/**
 * "What people say": short quotes with a name, a title and a public source.
 *
 * Empty until Chris supplies real ones (CONTENT_QUESTIONS.md). The block does
 * not render with fewer than MIN_TESTIMONIALS complete entries, and
 * `testimonials.test.ts` refuses a quote with a missing field, a placeholder,
 * or no link to where it was said: an unattributed quote is worse than none.
 */
export type Testimonial = {
  readonly quote: string;
  readonly name: string;
  readonly title: string;
  /** Where the quote is public: a LinkedIn recommendation, a post. */
  readonly sourceUrl: string;
};

export const MIN_TESTIMONIALS = 2;

export const TESTIMONIALS: readonly Testimonial[] = [];

/** External open-source work, talks or community roles; omitted while empty. */
export type CommunityItem = {
  readonly label: string;
  readonly href: string;
};

export const COMMUNITY: readonly CommunityItem[] = [];

export const shownTestimonials = (
  items: readonly Testimonial[] = TESTIMONIALS
): readonly Testimonial[] => (items.length >= MIN_TESTIMONIALS ? items : []);
