import { describe, expect, test } from 'bun:test';

import { SITE_DESCRIPTION } from '../lib/seo';
import { CONTENT } from './content';
import { logisticsLines } from './hero';
import { TOPIC_TO_NAME } from './topic';

/**
 * Copy rules, enforced rather than remembered. Hand-written prose states what
 * stays true; anything that moves — counts, dates, the stack — is derived from
 * data or left to the part of the page that renders it. The one exception is a
 * work highlight: a completed outcome is a fact that does not drift, and a
 * senior-role bullet without a number or a checkable artifact is the bullet a
 * reviewer skips.
 */

const ALL_PROJECTS = [...CONTENT.PROJECTS, ...CONTENT.ARCHIVE_PROJECTS];

/** One printed line on the resume, so a description is never clipped there. */
const MAX_DESCRIPTION_CHARS = 160;
/** What a search result or link preview shows before it truncates. */
const MAX_META_DESCRIPTION_CHARS = 160;
/** A bullet longer than this is two ideas, or padding. */
const MAX_BULLET_WORDS = 28;

const stripTags = (html: string): string => html.replace(/<[^>]*>/g, '');
const words = (html: string): number =>
  stripTags(html).split(/\s+/).filter(Boolean).length;

type Entry = readonly [string, string];

const storyProse = (): Entry[] =>
  [CONTENT.AGENTIC_END_TO_END, CONTENT.AGENTIC_CANDOR].flatMap((story) => [
    [`${story.title}.gist`, story.gist] as const,
    ...story.steps.map(
      (step, i) => [`${story.title}[${i}]`, step.text] as const
    ),
  ]);

/** Every hand-written sentence a reader sees outside the work highlights. */
const prose = (): readonly Entry[] => [
  ['hero.statement', CONTENT.HERO.statement],
  ['hero.statementSecondary', CONTENT.HERO.statementSecondary],
  ['hero.availability', CONTENT.HERO.availability],
  ...logisticsLines()
    .filter((line) => !line.startsWith('UTC'))
    .map((line, i) => [`logistics[${i}]`, line] as const),
  ['agentic.title', CONTENT.AGENTIC_WORKFLOW_TITLE],
  ['agentic.cursor', CONTENT.AGENTIC_CURSOR_TEXT],
  ['agentic.tooling', CONTENT.AGENTIC_TOOLING.lead],
  ['agentic.harnesses', CONTENT.AGENTIC_TOOLING.harnesses],
  ['proof.lede', CONTENT.PROOF_LEDE],
  ['proof.calendar', CONTENT.PROOF_CALENDAR_NOTE],
  ['contact.headline', CONTENT.CONTACT_COPY.headline],
  ['contact.sub', CONTENT.CONTACT_COPY.sub],
  ...CONTENT.ABOUT_ME_PARAGRAPHS.map(
    (text, i) => [`about[${i}]`, text] as const
  ),
  ...CONTENT.AGENTIC_PRINCIPLES.flatMap((p, i) => [
    [`agentic.principles[${i}].title`, p.title] as const,
    [`agentic.principles[${i}].body`, p.body] as const,
  ]),
  ...storyProse(),
  ...ALL_PROJECTS.map((p) => [`project.${p.id}`, p.description] as const),
];

const highlights = (): readonly Entry[] =>
  CONTENT.WORK.flatMap((work) =>
    work.highlights.map((text, i) => [`work.${work.name}[${i}]`, text] as const)
  );

const escapeRegExp = (text: string): string =>
  text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Whole-word and case-sensitive, so "Go" the language is not "go" the verb. */
const TECHNOLOGY = new RegExp(
  `(?<![A-Za-z])(${Object.values(TOPIC_TO_NAME).map(escapeRegExp).join('|')})(?![A-Za-z])`
);

/** A calendar year: true on the day it is typed, wrong a year later. */
const YEAR = /(?<!\d)(19|20)\d{2}(?!\d)/;

/** A number, a percentage, money, or a link to the thing itself. */
const EVIDENCE = /\d|%|\$|<a\s/;

const offenders = (entries: readonly Entry[], pattern: RegExp): string[] =>
  entries
    .filter(([, text]) => pattern.test(stripTags(text)))
    .map(([where]) => where);

describe('prose is timeless', () => {
  // A count is true on the day it is typed and drifts from then on.
  test('no numbers outside work highlights: counts are derived, never typed', () => {
    expect(offenders(prose(), /\d/)).toEqual([]);
  });

  test('no calendar years anywhere: dates are derived from work.ts', () => {
    expect(offenders([...prose(), ...highlights()], YEAR)).toEqual([]);
  });

  // The stack is real but it is an implementation detail: the topic chips, the
  // Toolbox and the resume's Skills derive it from the project registry.
  test('no technology names: the stack is shown by what derives it', () => {
    expect(offenders([...prose(), ...highlights()], TECHNOLOGY)).toEqual([]);
  });
});

describe('work highlights', () => {
  const senior = CONTENT.WORK.filter((work) => /Senior/.test(work.jobTitle));

  test('the senior roles exist, so the evidence rule below is not vacuous', () => {
    expect(senior.length).toBeGreaterThanOrEqual(2);
  });

  test('every senior-role bullet carries a number or links its artifact', () => {
    const bare = senior.flatMap((work) =>
      work.highlights
        .filter((text) => !EVIDENCE.test(text))
        .map((text) => `${work.name}: ${stripTags(text)}`)
    );
    expect(bare).toEqual([]);
  });

  test(`are at most ${String(MAX_BULLET_WORDS)} words`, () => {
    const long = highlights()
      .filter(([, text]) => words(text) > MAX_BULLET_WORDS)
      .map(([where, text]) => `${where} (${String(words(text))})`);
    expect(long).toEqual([]);
  });

  // Job-description voice ("Build…", "Work with…") is a duty, not a result.
  test('open with a past-tense verb or a role, never a present-tense duty', () => {
    const duty = /^(Build|Work|Own|Turn|Lead|Design|Develop|Help)\b/;
    expect(offenders(highlights(), duty)).toEqual([]);
  });
});

describe('terminology', () => {
  // One term per idea, so a screener's keyword match and a reader's eye agree.
  test('"AI coding agents", never "AI agents" or "LLMs"', () => {
    expect(
      offenders([...prose(), ...highlights()], /\bAI agents?\b|\bLLMs?\b/)
    ).toEqual([]);
  });

  test('"résumé" with accents in reader-facing copy', () => {
    expect(
      offenders([...prose(), ...highlights()], /\b[Rr]esume\b|\bCV\b/)
    ).toEqual([]);
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

  // The differentiator is the method; a screener's search for it must hit.
  test('the pitch names AI coding agents', () => {
    expect(CONTENT.HERO.statement).toContain('AI coding agents');
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
