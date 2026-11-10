import { describe, expect, test } from 'bun:test';

import { ARCHETYPES, ARCHETYPE_IDS } from './definitions';
import { ARCHETYPE_CARDS, LANDSCAPE_SUMMARY } from './index-view';

/** A description has to say what the segment is, not just name it. */
const MIN_DESCRIPTION_WORDS = 20;

describe('archetype index', () => {
  test('lists every archetype once, with exactly one default', () => {
    expect(ARCHETYPE_CARDS.map((card) => card.id).sort()).toEqual(
      [...ARCHETYPE_IDS].sort()
    );
    expect(ARCHETYPE_CARDS.filter((card) => card.isDefault)).toHaveLength(1);
  });

  test('every archetype is described', () => {
    const thin = ARCHETYPES.filter(
      (archetype) =>
        archetype.description.split(/\s+/).length < MIN_DESCRIPTION_WORDS
    ).map((archetype) => archetype.id);
    expect(thin).toEqual([]);
  });

  test('every card carries the numbers that justify it', () => {
    for (const card of ARCHETYPE_CARDS) {
      expect(card.justification).toMatch(/^\d+ postings, \d+% of the sample/);
      expect(card.stats.map((stat) => stat.value)).not.toContain('');
      expect(card.themes.length).toBeGreaterThan(0);
      expect(card.skills.length).toBeGreaterThan(0);
      expect(card.samples.length).toBeGreaterThan(0);
    }
  });

  test('each card opens its own presentation and résumé', () => {
    for (const card of ARCHETYPE_CARDS) {
      const query = card.isDefault ? '' : `?archetype=${card.id}`;
      expect(card.href).toBe(`/${query}`);
      expect(card.resumeHref).toBe(`/chris-vouga-resume.pdf${query}`);
    }
  });

  test('the summary accounts for every sampled posting', () => {
    const { fetched, eligible, needsClearance, outOfScope } = LANDSCAPE_SUMMARY;
    expect(eligible + needsClearance + outOfScope).toBe(fetched);
  });
});
