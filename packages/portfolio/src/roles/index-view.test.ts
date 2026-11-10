import { describe, expect, test } from 'bun:test';

import { ROLES, ROLE_IDS } from './definitions';
import { ROLE_CARDS, LANDSCAPE_SUMMARY } from './index-view';

/** A description has to say what the segment is, not just name it. */
const MIN_DESCRIPTION_WORDS = 20;

describe('role index', () => {
  test('lists every role once, with exactly one default', () => {
    expect(ROLE_CARDS.map((card) => card.id).sort()).toEqual(
      [...ROLE_IDS].sort()
    );
    expect(ROLE_CARDS.filter((card) => card.isDefault)).toHaveLength(1);
  });

  test('every role is described', () => {
    const thin = ROLES.filter(
      (role) => role.description.split(/\s+/).length < MIN_DESCRIPTION_WORDS
    ).map((role) => role.id);
    expect(thin).toEqual([]);
  });

  test('every card carries the numbers that justify it', () => {
    for (const card of ROLE_CARDS) {
      expect(card.justification).toMatch(/^\d+ postings, \d+% of the sample/);
      expect(card.stats.map((stat) => stat.value)).not.toContain('');
      expect(card.themes.length).toBeGreaterThan(0);
      expect(card.skills.length).toBeGreaterThan(0);
      expect(card.samples.length).toBeGreaterThan(0);
    }
  });

  test('each card opens its own presentation, résumé and details page by path', () => {
    for (const card of ROLE_CARDS) {
      const home = card.isDefault ? '/' : `/a/${card.id}/`;
      expect(card.href).toBe(home);
      expect(card.resumeHref).toBe(`${home}chris-vouga-resume.pdf`);
      expect(card.detailsHref).toBe(`/roles/${card.id}/`);
    }
  });

  test('the summary accounts for every sampled posting', () => {
    const { fetched, eligible, needsClearance, outOfScope } = LANDSCAPE_SUMMARY;
    expect(eligible + needsClearance + outOfScope).toBe(fetched);
  });
});
