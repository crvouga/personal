#!/usr/bin/env bun
/**
 * Counts gamezilla's specifications from its (private) repository and writes
 * `src/data/gamezilla-facts.json`. The daily Maintenance job cannot read a
 * private repository with its token, so Chris runs this by hand; the case
 * study prints the as-of date, so an old figure is never presented as current.
 *
 * Usage (from packages/portfolio): GITHUB_TOKEN=$(gh auth token) bun run gamezilla-facts
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import type { GamezillaFacts } from '../src/lib/gamezilla-facts';
import { writeLine } from '../src/library/cli-output';

const REPO = 'crvouga/gamezilla';
const OUT = resolve(import.meta.dir, '../src/data/gamezilla-facts.json');

const git = (cwd: string, args: readonly string[]): string => {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (result.status !== 0)
    throw new Error(`git ${args.join(' ')}: ${result.stderr}`);
  return result.stdout;
};

const clone = (token: string): string => {
  const dir = join(mkdtempSync(join(tmpdir(), 'gamezilla-facts-')), 'repo');
  const url = `https://x-access-token:${token}@github.com/${REPO}.git`;
  git(tmpdir(), ['clone', '--quiet', '--depth', '1', url, dir]);
  return dir;
};

const files = (dir: string): string[] =>
  git(dir, ['ls-files']).split('\n').filter(Boolean);

const countScenarios = async (
  dir: string,
  features: readonly string[]
): Promise<number> => {
  let total = 0;
  for (const file of features) {
    const text = await Bun.file(join(dir, file)).text();
    total +=
      text.match(/^\s*(Scenario|Scenario Outline|Example):/gm)?.length ?? 0;
  }
  return total;
};

const commits = async (token: string): Promise<number> => {
  const response = await fetch(
    `https://api.github.com/repos/${REPO}/commits?per_page=1`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        'User-Agent': 'portfolio-facts',
      },
    }
  );
  if (!response.ok) throw new Error(`commits: HTTP ${String(response.status)}`);
  const last = /[?&]page=(\d+)>; rel="last"/.exec(
    response.headers.get('link') ?? ''
  );
  return last?.[1] === undefined ? 1 : Number(last[1]);
};

const main = async (): Promise<void> => {
  const token = process.env['GITHUB_TOKEN'] ?? '';
  if (token === '')
    throw new Error('GITHUB_TOKEN is required (gh auth token).');
  const dir = clone(token);
  const all = files(dir);
  const specs = all.filter((file) => file.startsWith('specs/'));
  const byKind = (kind: string): string[] =>
    specs.filter((file) => file.endsWith(`.${kind}`));
  const facts: GamezillaFacts = {
    version: 1,
    asOf: new Date().toISOString().slice(0, 10),
    commit: git(dir, ['rev-parse', '--short', 'HEAD']).trim(),
    commits: await commits(token),
    behaviorSpecs: byKind('feature').length,
    scenarios: await countScenarios(dir, byKind('feature')),
    stateModels: byKind('qnt').length,
    structureModels: byKind('als').length,
    decisionTables: byKind('dmn').length,
    serviceObjectives: byKind('openslo.yaml').length,
    propertyTestFiles: all.filter((file) => file.endsWith('.property.test.ts'))
      .length,
  };
  writeFileSync(OUT, `${JSON.stringify(facts, null, 2)}\n`, 'utf8');
  writeLine(`wrote ${OUT}: ${JSON.stringify(facts)}`);
};

if (import.meta.main) await main();
