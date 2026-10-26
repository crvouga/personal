import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { CONTENT } from '../content/content';
import { buildResumeContent } from '../resume/content';
import { buildCardContent } from '../social/card';
import {
  CANDIDATE_SUMMARY,
  buildConsistencyChecklist,
  buildLlmsTxt,
  buildProfileReadme,
  buildResumeJson,
} from './candidate';
import { HOME_SEO } from './seo';
import { buildJsonLd } from './seo-json-ld';

/**
 * Site, résumé, /resume.json, /llms.txt, JSON-LD, the share card and the
 * GitHub profile README tell one story: each derives its lead from
 * HERO.statement, never from a second copy.
 */
const resumeJson = buildResumeJson(new Date('2026-10-26T00:00:00Z'));

const ISO_DATE = /^([12]\d{3}-[01]\d-[0-3]\d|[12]\d{3}-[01]\d|[12]\d{3})$/;
const URL_FIELD = /^https?:\/\//;

type Json = Record<string, unknown>;
const records = (value: unknown): Json[] =>
  Array.isArray(value) ? (value as Json[]) : [];

describe('JSON Resume (v1.0.0 schema)', () => {
  // The schema's own top-level properties; anything else is a typo.
  const TOP_LEVEL = new Set([
    '$schema',
    'basics',
    'work',
    'volunteer',
    'education',
    'awards',
    'certificates',
    'publications',
    'skills',
    'languages',
    'interests',
    'references',
    'projects',
    'meta',
  ]);

  test('has only schema properties at the top level', () => {
    expect(
      Object.keys(resumeJson).filter((key) => !TOP_LEVEL.has(key))
    ).toEqual([]);
  });

  test('basics are complete and typed as the schema requires', () => {
    const basics = resumeJson['basics'] as Json;
    for (const key of ['name', 'label', 'email', 'url', 'summary']) {
      expect(typeof basics[key]).toBe('string');
      expect(basics[key]).not.toBe('');
    }
    expect(basics['email']).toMatch(/^[^@\s]+@[^@\s]+$/);
    expect(basics['url']).toMatch(URL_FIELD);
    for (const profile of records(basics['profiles'])) {
      expect(profile['url']).toMatch(URL_FIELD);
    }
  });

  test('every date is ISO 8601 as the schema pattern allows', () => {
    const dates = [
      ...records(resumeJson['work']),
      ...records(resumeJson['education']),
    ]
      .flatMap((entry) => [entry['startDate'], entry['endDate']])
      .filter((date) => date !== undefined);
    expect(dates.length).toBeGreaterThan(0);
    expect(dates.filter((date) => !ISO_DATE.test(String(date)))).toEqual([]);
  });

  test('work entries match the page: titles, order, highlights', () => {
    const work = records(resumeJson['work']);
    expect(work.map((w) => w['position'])).toEqual(
      CONTENT.WORK.map((w) => w.jobTitle)
    );
    expect(work.map((w) => w['name'])).toEqual(CONTENT.WORK.map((w) => w.name));
    for (const entry of work) {
      for (const highlight of records(entry['highlights'])) {
        expect(String(highlight)).not.toMatch(/<[^>]+>/);
      }
    }
  });

  test('skills and projects are non-empty arrays of strings', () => {
    for (const skill of records(resumeJson['skills'])) {
      expect(typeof skill['name']).toBe('string');
      expect(
        (skill['keywords'] as unknown[]).every((k) => typeof k === 'string')
      ).toBe(true);
    }
    expect(records(resumeJson['projects']).length).toBe(3);
  });
});

describe('one story everywhere', () => {
  const statement = CONTENT.HERO.statement;

  test('every surface leads with HERO.statement', () => {
    expect(CANDIDATE_SUMMARY.startsWith(statement)).toBe(true);
    expect((resumeJson['basics'] as Json)['summary']).toBe(CANDIDATE_SUMMARY);
    expect(buildResumeContent().summary[0]).toBe(statement);
    expect(buildLlmsTxt()).toContain(`> ${statement}`);
    expect(buildProfileReadme()).toContain(statement);
    expect(buildCardContent().statement).toBe(statement);
    expect(HOME_SEO.description).toBe(statement);
    const graph = (buildJsonLd(HOME_SEO)?.['@graph'] ?? []) as Json[];
    const person = graph.find((node) => node['@type'] === 'Person');
    expect(person?.['description']).toBe(statement);
  });

  test('the JSON-LD Person has no empty fields', () => {
    const graph = (buildJsonLd(HOME_SEO)?.['@graph'] ?? []) as Json[];
    const person = graph.find((node) => node['@type'] === 'Person') ?? {};
    const empty = Object.entries(person).filter(
      ([, value]) =>
        value === undefined ||
        value === '' ||
        (Array.isArray(value) && value.length === 0)
    );
    expect(empty).toEqual([]);
    for (const key of [
      'jobTitle',
      'knowsAbout',
      'hasOccupation',
      'alumniOf',
      'sameAs',
      'address',
    ]) {
      expect(person[key]).toBeDefined();
    }
  });

  test('/llms.txt is candidate information and points agents to the infra guide', () => {
    const text = buildLlmsTxt();
    expect(text.startsWith(`# ${CONTENT.PAGE_TITLE}`)).toBe(true);
    expect(text).toContain('/resume.json');
    expect(text).toContain('/llms-infra.txt');
    expect(text).not.toMatch(/secret\/data|R2 bucket|vault login/i);
  });

  test('the committed GitHub profile README is current (bun run gen:profile-readme)', () => {
    const committed = readFileSync(
      join(import.meta.dir, '../../generated/github-profile-README.md'),
      'utf8'
    );
    expect(committed).toBe(buildProfileReadme());
  });

  test('the committed consistency checklist is current (bun run gen:profile-readme)', () => {
    const committed = readFileSync(
      join(import.meta.dir, '../../CONSISTENCY_CHECKLIST.md'),
      'utf8'
    );
    expect(committed).toBe(buildConsistencyChecklist());
  });
});
