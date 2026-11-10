import { describe, expect, test } from 'bun:test';

import type { Fact } from '../knowledge/index';
import { researchFor } from '../market/research';
import { checkCriterion, gapReport, readinessOf } from './gaps';

const report = gapReport(new Date('2026-11-10'));

const fact = (themes: Fact['themes'], professional = true): Fact => ({
  id: `probe-${themes.join('-')}`,
  kind: 'achievement',
  where: 'Probe',
  title: 'Probe',
  text: 'Probe',
  themes,
  topics: [],
  professional,
});

describe('gap analysis: personal knowledge base × market knowledge base', () => {
  test('covers every role, each with a readiness between 0 and 1', () => {
    expect(report.roles.length).toBeGreaterThan(0);
    for (const role of report.roles) {
      expect(role.readiness).toBeGreaterThanOrEqual(0);
      expect(role.readiness).toBeLessThanOrEqual(1);
      expect(role.criteria.length).toBe(researchFor(role.id).criteria.length);
    }
  });

  test('a new fact closes a gap: evidence moves a criterion from missing to shown', () => {
    const research = researchFor('ai-product-engineer');
    const criterion = research.criteria[0];
    if (criterion === undefined) throw new Error('research has no criteria');
    const none = checkCriterion(criterion, research, [], new Set());
    expect(none.coverage).toBe('missing');
    const two = [
      fact(criterion.themes),
      { ...fact(criterion.themes), id: 'b' },
    ];
    const shown = checkCriterion(
      criterion,
      research,
      two,
      new Set(criterion.skills)
    );
    expect(shown.coverage).toBe('shown');
    expect(readinessOf([shown])).toBe(1);
    expect(readinessOf([none])).toBe(0);
  });

  test('side projects alone never make a criterion shown', () => {
    const research = researchFor('ai-product-engineer');
    const criterion = research.criteria[0];
    if (criterion === undefined) throw new Error('research has no criteria');
    const side = [
      fact(criterion.themes, false),
      { ...fact(criterion.themes, false), id: 'b' },
    ];
    expect(
      checkCriterion(criterion, research, side, new Set(criterion.skills))
        .coverage
    ).toBe('partial');
  });

  test('actions are unshown criteria, highest payoff first, one per ask', () => {
    const priorities = report.actions.map((action) => action.priority);
    expect(priorities).toEqual([...priorities].sort((a, b) => b - a));
    expect(report.actions.every((action) => action.coverage !== 'shown')).toBe(
      true
    );
    const labels = report.actions.map((action) => action.label.toLowerCase());
    expect(new Set(labels).size).toBe(labels.length);
  });

  test('every cited source resolves to a URL', () => {
    const sources = report.roles.flatMap((role) =>
      role.criteria.flatMap((row) => row.sources)
    );
    expect(sources.every((source) => source.url.startsWith('http'))).toBe(true);
  });
});
