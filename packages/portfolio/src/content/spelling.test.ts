import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { CASE_STUDIES } from './case-studies';
import { CONTENT } from './content';
import { logisticsLines } from './hero';

/**
 * Every reader-facing registry string, spell-checked. A typo on a site whose
 * pitch is "I verify everything" costs more than anywhere else. Product and
 * technical names the dictionary does not know are allow-listed below, each
 * one deliberately.
 */
const ALLOWED = [
  'Vouga',
  'crvouga',
  'chrisvouga',
  'gamezilla',
  'Geviti',
  'gogeviti',
  'Triangulator',
  'Mockingbird',
  'Orchard',
  'Sun',
  'Devils',
  'Airr',
  'Pickflix',
  'moviefinder',
  'normalizer',
  'combobox',
  'Violet',
  'OpenTofu',
  'OpenBao',
  'NixOS',
  'Bun',
  'Astro',
  'Railway',
  'Cloudflare',
  'Playwright',
  'OpenAPI',
  'fast-check',
  'SDK',
  'SQLite',
  'PostgreSQL',
  'Postgres',
  'npm',
  'admin',
  'monorepo',
  'Codex',
  'OpenCode',
  'Windsurf',
  'Copilot',
  'résumé',
  'Résumé',
  'opt-in',
  'onboarding',
  'precalculus', 'bloodwork',
  'Tripolar',
  'longevity',
  'Crash',
  'pug',
  'ids',
  'repo',
  'repos',
];

const strip = (html: string): string =>
  html.replace(/<[^>]*>/g, ' ').replace(/https?:\S+/g, ' ');

const corpus = (): string =>
  [
    CONTENT.HERO.statement,
    CONTENT.HERO.statementSecondary,
    CONTENT.HERO.availability,
    ...logisticsLines(),
    CONTENT.PROOF_LEDE,
    CONTENT.PROOF_CALENDAR_NOTE,
    CONTENT.AGENTIC_WORKFLOW_TITLE,
    CONTENT.AGENTIC_TOOLING.lead,
    CONTENT.AGENTIC_TOOLING.harnesses,
    ...CONTENT.AGENTIC_PRINCIPLES.flatMap((p) => [
      p.title,
      p.body,
      ...p.receipts.map((r) => r.label),
    ]),
    ...[CONTENT.AGENTIC_END_TO_END, CONTENT.AGENTIC_CANDOR].flatMap((s) => [
      s.title,
      s.gist,
      ...s.steps.map((x) => x.text),
    ]),
    ...CONTENT.ABOUT_ME_PARAGRAPHS,
    CONTENT.CONTACT_COPY.headline,
    CONTENT.CONTACT_COPY.sub,
    ...CONTENT.WORK.flatMap((w) => [
      w.jobTitle,
      ...w.highlights,
      ...(w.awards ?? []),
      w.imageAlt,
    ]),
    ...[...CONTENT.PROJECTS, ...CONTENT.ARCHIVE_PROJECTS].flatMap((p) => [
      p.description,
      p.imageAlt,
    ]),
    ...CASE_STUDIES.flatMap((c) => [
      c.title,
      c.subline,
      c.description,
      ...c.problem,
      ...c.constraints,
      ...c.design,
      ...c.correctness,
      ...c.outcome,
      ...c.differently,
      c.hero.alt,
      ...c.links.map((l) => l.label),
    ]),
  ]
    .map(strip)
    .join('\n');

const CSPELL = join(import.meta.dir, '../../node_modules/.bin/cspell');

/** Unknown words in `text`. Runs from its own directory: cspell ignores paths outside its cwd. */
const misspelled = (text: string): string[] => {
  const dir = mkdtempSync(join(tmpdir(), 'portfolio-spelling-'));
  writeFileSync(join(dir, 'copy.txt'), text);
  writeFileSync(
    join(dir, 'cspell.json'),
    JSON.stringify({
      version: '0.2',
      language: 'en-US',
      words: ALLOWED,
      ignoreRegExpList: ['/\\b[a-z0-9-]+\\.[a-z]{2,}\\b/g'],
    })
  );
  const result = spawnSync(
    CSPELL,
    [
      'lint',
      '--no-progress',
      '--no-summary',
      '--words-only',
      '--unique',
      'copy.txt',
    ],
    { cwd: dir, encoding: 'utf8' }
  );
  if (/No files found/i.test(result.stderr))
    throw new Error('cspell checked nothing');
  return result.stdout.split('\n').filter(Boolean);
};

describe('spelling', () => {
  test('the checker catches a typo (so a pass below means something)', () => {
    expect(misspelled('I recieve the package.')).toEqual(['recieve']);
  }, 60_000);

  test('every registry string passes the spell checker', () => {
    expect(misspelled(corpus())).toEqual([]);
  }, 60_000);
});
