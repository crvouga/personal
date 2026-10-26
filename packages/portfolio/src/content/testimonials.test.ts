import { describe, expect, test } from 'bun:test';

import {
  COMMUNITY,
  MIN_TESTIMONIALS,
  TESTIMONIALS,
  shownTestimonials,
  type Testimonial,
} from './testimonials';

const PLACEHOLDER = /NEEDS_INPUT|lorem|TODO|TBD|\[\[|\{\{/i;

const complete = (t: Testimonial): boolean =>
  [t.quote, t.name, t.title].every((field) => field.trim().length > 0) &&
  /^https:\/\//.test(t.sourceUrl) &&
  !PLACEHOLDER.test(JSON.stringify(t));

describe('social proof', () => {
  test('every quote is attributed, linked and real', () => {
    expect(TESTIMONIALS.filter((t) => !complete(t))).toEqual([]);
  });

  test('the block renders only with enough quotes to mean something', () => {
    const one: Testimonial = {
      quote: 'q',
      name: 'n',
      title: 't',
      sourceUrl: 'https://example.com',
    };
    expect(shownTestimonials([one])).toEqual([]);
    expect(shownTestimonials(Array(MIN_TESTIMONIALS).fill(one))).toHaveLength(
      MIN_TESTIMONIALS
    );
  });

  test('community entries link somewhere public', () => {
    expect(COMMUNITY.filter((c) => !/^https:\/\//.test(c.href))).toEqual([]);
  });
});
