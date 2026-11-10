import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { TOPIC_TO_NAME } from '../content/topic';
import { CAPABILITIES } from '../knowledge/capabilities';
import { PROJECT_FACTS } from '../knowledge/projects';
import { ARCHIVE_PROJECT_FACTS } from '../knowledge/projects-archive';
import { ROLES } from '../knowledge/roles';
import { THEME_IDS } from '../knowledge/themes';
import { MAX_THEMES_PER_FACT } from '../knowledge/types';
import { buildResumeContent } from '../resume/content';
import {
  ARCHETYPES,
  ARCHETYPE_IDS,
  ARCHETYPE_ID_PATTERN,
  DEFAULT_ARCHETYPE_ID,
} from './definitions';
import { demandFor } from './demand';
import {
  DEFAULT_PRESENTATION,
  VARIANT_PRESENTATIONS,
  presentationFor,
  resolvePresentation,
} from './presentation';
import { SKILLS } from './skills';
import { statusOf } from './status';
import { VOICES } from './voice';

const ROOT = join(import.meta.dir, '..', '..');
const NGINX = readFileSync(join(ROOT, 'nginx.conf'), 'utf8');

/** Enough postings that a share is a measurement, not an anecdote. */
const MIN_POSTINGS = 50;
/** What a search result or link preview shows before it truncates. */
const MAX_STATEMENT_CHARS = 160;

const PRESENTATIONS = ARCHETYPE_IDS.map(presentationFor);
const sorted = (items: readonly string[]): string[] => [...items].sort();

describe('archetypes', () => {
  test('every id is a valid URL segment, and unique', () => {
    expect(
      ARCHETYPE_IDS.filter((id) => !ARCHETYPE_ID_PATTERN.test(id))
    ).toEqual([]);
    expect(new Set(ARCHETYPE_IDS).size).toBe(ARCHETYPE_IDS.length);
    expect(ARCHETYPE_IDS).toContain(DEFAULT_ARCHETYPE_ID);
  });

  test('nginx accepts exactly the values the site does', () => {
    expect(NGINX).toContain(
      `"~${ARCHETYPE_ID_PATTERN.source}" $arg_archetype;`
    );
  });

  test('each is backed by enough postings to measure', () => {
    const thin = ARCHETYPES.filter(
      (archetype) => demandFor(archetype).postings < MIN_POSTINGS
    ).map((archetype) => archetype.id);
    expect(thin).toEqual([]);
  });

  test('no two archetypes claim the same market segment', () => {
    const cells = ARCHETYPES.flatMap((archetype) =>
      archetype.cells.flatMap((cell) =>
        cell.levels.map((level) => `${cell.context}/${level}`)
      )
    );
    expect(new Set(cells).size).toBe(cells.length);
  });

  test('an unknown or missing archetype is the default presentation', () => {
    expect(resolvePresentation(null)).toBe(DEFAULT_PRESENTATION);
    expect(resolvePresentation('')).toBe(DEFAULT_PRESENTATION);
    expect(resolvePresentation('../../etc/passwd')).toBe(DEFAULT_PRESENTATION);
    expect(resolvePresentation('not-an-archetype')).toBe(DEFAULT_PRESENTATION);
    expect(DEFAULT_PRESENTATION.query).toBe('');
    expect(DEFAULT_PRESENTATION.home).toBe('/');
    for (const variant of VARIANT_PRESENTATIONS) {
      expect(variant.home).toBe(`/a/${variant.id}/`);
    }
    expect(VARIANT_PRESENTATIONS).toHaveLength(ARCHETYPE_IDS.length - 1);
  });

  test('the status report runs and names a best default', () => {
    expect(ARCHETYPE_IDS).toContain(statusOf().bestDefault);
  });
});

describe('knowledge base', () => {
  const facts = [
    ...PROJECT_FACTS.map((fact) => ({ ...fact, text: fact.description })),
    ...ARCHIVE_PROJECT_FACTS.map((fact) => ({
      ...fact,
      text: fact.description,
    })),
    ...ROLES.flatMap((role) => role.achievements),
  ];

  test('fact ids are unique', () => {
    const ids = facts.map((fact) => fact.id);
    expect(ids.filter((id, index) => ids.indexOf(id) !== index)).toEqual([]);
  });

  test('themes are from the vocabulary, and few enough to mean something', () => {
    const known = new Set<string>(THEME_IDS);
    const bad = facts
      .filter(
        (fact) =>
          fact.themes.length > MAX_THEMES_PER_FACT ||
          fact.themes.some((theme) => !known.has(theme)) ||
          new Set(fact.themes).size !== fact.themes.length
      )
      .map((fact) => fact.id);
    expect(bad).toEqual([]);
  });

  test('every achievement and listed project is evidence of something', () => {
    const untagged = [
      ...PROJECT_FACTS,
      ...ROLES.flatMap((role) => role.achievements),
    ]
      .filter((fact) => fact.themes.length === 0)
      .map((fact) => fact.id);
    expect(untagged).toEqual([]);
  });

  test('holds no presentation: no HTML and no asset paths', () => {
    const marked = facts
      .filter((fact) => /<[a-z/]|\.(webp|png|jpe?g|svg)\b/i.test(fact.text))
      .map((fact) => fact.id);
    expect(marked).toEqual([]);
  });

  test('every claimed capability is a skill the market vocabulary knows', () => {
    const known = new Set(SKILLS.map((skill) => skill.id));
    expect(
      CAPABILITIES.filter((capability) => !known.has(capability.skill))
    ).toEqual([]);
    expect(CAPABILITIES.filter((c) => c.evidence.trim() === '')).toEqual([]);
  });
});

describe('voices obey the copy rules', () => {
  const lines = ARCHETYPE_IDS.flatMap((id) => {
    const voice = VOICES[id];
    return [
      [`${id}.eyebrow`, voice.eyebrow],
      [`${id}.statement`, voice.statement],
      [`${id}.statementSecondary`, voice.statementSecondary],
      [`${id}.availability`, voice.availability],
      ...Object.entries(voice.titles ?? {}).map(
        ([section, title]) => [`${id}.titles.${section}`, title] as const
      ),
    ] as const;
  });
  const offenders = (pattern: RegExp): string[] =>
    lines.filter(([, text]) => pattern.test(text)).map(([where]) => where);
  const escape = (text: string): string =>
    text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const technology = new RegExp(
    `(?<![A-Za-z])(${Object.values(TOPIC_TO_NAME).map(escape).join('|')})(?![A-Za-z])`
  );

  test('no typed numbers or years', () => {
    expect(offenders(/\d/)).toEqual([]);
  });

  test('no technology names: the stack is shown by what derives it', () => {
    expect(offenders(technology)).toEqual([]);
  });

  test('"AI coding agents", never "AI agents" or "LLMs"; "résumé" accented', () => {
    expect(offenders(/\bAI agents?\b|\bLLMs?\b|\b[Rr]esume\b|\bCV\b/)).toEqual(
      []
    );
  });

  test('the statement fits a search snippet and a share preview', () => {
    const long = ARCHETYPE_IDS.filter(
      (id) => VOICES[id].statement.length > MAX_STATEMENT_CHARS
    );
    expect(long).toEqual([]);
  });

  test('statements differ: each archetype gets its own pitch', () => {
    const statements = ARCHETYPE_IDS.map((id) => VOICES[id].statement);
    expect(new Set(statements).size).toBe(statements.length);
  });

  test('basedOn names real themes', () => {
    const known = new Set<string>(THEME_IDS);
    const unknown = ARCHETYPE_IDS.flatMap((id) =>
      VOICES[id].basedOn.filter((theme) => !known.has(theme))
    );
    expect(unknown).toEqual([]);
  });
});

describe('presentations reorder facts and never drop one', () => {
  test('every presentation shows every role with every highlight', () => {
    const expected = DEFAULT_PRESENTATION.work.map((job) =>
      sorted(job.highlights)
    );
    for (const presentation of PRESENTATIONS) {
      expect(presentation.work.map((job) => job.name)).toEqual(
        DEFAULT_PRESENTATION.work.map((job) => job.name)
      );
      expect(presentation.work.map((job) => sorted(job.highlights))).toEqual(
        expected
      );
    }
  });

  test('every presentation has all six sections once, and three flagships', () => {
    for (const presentation of PRESENTATIONS) {
      expect(
        sorted(presentation.sections.map((section) => section.id))
      ).toEqual(
        sorted(DEFAULT_PRESENTATION.sections.map((section) => section.id))
      );
      expect(presentation.projects).toHaveLength(3);
      expect(presentation.galleries).toHaveLength(
        presentation.projects.length + presentation.work.length
      );
    }
  });

  test('the résumé speaks in the presentation’s voice and keeps every role', () => {
    for (const presentation of PRESENTATIONS) {
      const resume = buildResumeContent(presentation);
      expect(resume.summary[0]).toBe(presentation.voice.statement);
      expect(resume.experience).toHaveLength(ROLES.length);
      expect(resume.accent).toBe(presentation.theme.resumeAccent);
    }
  });

  test('ranking actually differs between audiences', () => {
    const orders = PRESENTATIONS.map((presentation) =>
      JSON.stringify([
        presentation.work.map((job) => job.highlights),
        presentation.projects.map((project) => project.id),
      ])
    );
    expect(new Set(orders).size).toBeGreaterThan(1);
  });
});
