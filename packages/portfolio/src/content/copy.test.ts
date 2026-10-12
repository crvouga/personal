import { describe, expect, test } from 'bun:test';

import { SITE_DESCRIPTION } from '../lib/seo';
import { CONTENT } from './content';
import { TOPIC_TO_NAME } from './topic';

/**
 * Copy rules, enforced rather than remembered. Hand-written prose states what
 * stays true; anything that moves — counts, dates, the stack — is derived from
 * data or left to the part of the page that renders it.
 */

const ALL_PROJECTS = [...CONTENT.PROJECTS, ...CONTENT.ARCHIVE_PROJECTS];

/** One printed line on the resume, so a description is never clipped there. */
const MAX_DESCRIPTION_CHARS = 160;
/** What a search result or link preview shows before it truncates. */
const MAX_META_DESCRIPTION_CHARS = 160;

const stripTags = (html: string): string => html.replace(/<[^>]*>/g, '');

/** Every hand-written sentence a reader sees, keyed by where it lives. */
const prose = (): readonly (readonly [string, string])[] => [
  ['hero.statement', CONTENT.HERO.statement],
  ['hero.statementSecondary', CONTENT.HERO.statementSecondary],
  ['hero.availability', CONTENT.HERO.availability],
  ['hero.location', CONTENT.HERO.location],
  ['agentic.title', CONTENT.AGENTIC_WORKFLOW_TITLE],
  ['agentic.cursor', CONTENT.AGENTIC_CURSOR_TEXT],
  ['proof.lede', CONTENT.PROOF_LEDE],
  ['contact.headline', CONTENT.CONTACT_COPY.headline],
  ['contact.sub', CONTENT.CONTACT_COPY.sub],
  ...CONTENT.ABOUT_ME_PARAGRAPHS.map(
    (text, i) => [`about[${i}]`, text] as const
  ),
  ...CONTENT.AGENTIC_WORKFLOW_POINTS.map(
    (text, i) => [`agentic.points[${i}]`, text] as const
  ),
  ...CONTENT.WORK.flatMap((work) =>
    work.highlights.map((text, i) => [`work.${work.name}[${i}]`, text] as const)
  ),
  ...ALL_PROJECTS.map((p) => [`project.${p.id}`, p.description] as const),
];

const escapeRegExp = (text: string): string =>
  text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Whole-word and case-sensitive, so "Go" the language is not "go" the verb. */
const TECHNOLOGY = new RegExp(
  `(?<![A-Za-z])(${Object.values(TOPIC_TO_NAME).map(escapeRegExp).join('|')})(?![A-Za-z])`
);

const offenders = (pattern: RegExp): string[] =>
  prose()
    .filter(([, text]) => pattern.test(stripTags(text)))
    .map(([where]) => where);

describe('prose is timeless', () => {
  // A count or a year is true on the day it is typed and drifts from then on.
  test('no numbers: counts and dates are derived, never typed', () => {
    expect(offenders(/\d/)).toEqual([]);
  });

  // The stack is real but it is an implementation detail: the topic chips, the
  // Toolbox and the resume's Skills derive it from the project registry.
  test('no technology names: the stack is shown by what derives it', () => {
    expect(offenders(TECHNOLOGY)).toEqual([]);
  });
});

describe('project descriptions', () => {
  test('are brief', () => {
    const long = ALL_PROJECTS.filter(
      (p) => p.description.length > MAX_DESCRIPTION_CHARS
    ).map((p) => p.id);
    expect(long).toEqual([]);
  });

  // Cards render them as text; the Live and Code links already do the linking.
  test('are plain text, with no markup and no links', () => {
    const marked = ALL_PROJECTS.filter((p) =>
      /[<>]|https?:|www\./.test(p.description)
    ).map((p) => p.id);
    expect(marked).toEqual([]);
  });

  test('end as whole sentences', () => {
    const open = ALL_PROJECTS.filter((p) => !/[.!?]$/.test(p.description)).map(
      (p) => p.id
    );
    expect(open).toEqual([]);
  });
});

describe('derived copy', () => {
  test('the meta description is the whole pitch and fits a search snippet', () => {
    expect(SITE_DESCRIPTION).toBe(CONTENT.HERO.statement);
    expect(SITE_DESCRIPTION.length).toBeLessThanOrEqual(
      MAX_META_DESCRIPTION_CHARS
    );
  });

  test('the hero stack only names technology a project actually uses', () => {
    const used = new Set(CONTENT.PROJECTS.flatMap((p) => p.topics));
    expect(CONTENT.CORE_STACK.filter((topic) => !used.has(topic))).toEqual([]);
  });

  test('the hero and the About copy follow the declared location', () => {
    expect(CONTENT.HERO.location).toContain(CONTENT.LOCATION);
    expect(CONTENT.ABOUT_ME_PARAGRAPHS.join(' ')).toContain(CONTENT.LOCATION);
  });
});
