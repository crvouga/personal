#!/usr/bin/env bun
/**
 * Scaffolds a new role: its role file and a market research to fill.
 *
 * Usage (from packages/portfolio):
 *   bun run roles:new <id> --label=<Word> --context=<startup|tech|corporate|contract> --levels=mid,senior
 *   bun run roles:new <id> --label=<Word> --family=<ai-product|platform|fullstack|architect> --levels=mid,senior,staff
 *
 * Then: research the research (`/portfolio-refresh` explains how), write the
 * voice, and run `bun run roles:sync`. The build fails until the research
 * parses and the voice passes the copy rules, so nothing half-done ships.
 */
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { ROLE_FILES_DIR, RESEARCH_DIR } from '../src/roles/codegen';
import { ROLE_ID_PATTERN } from '../src/roles/definitions';
import { writeLine } from '../src/library/cli-output';

const [id] = process.argv.slice(2).filter((arg) => !arg.startsWith('--'));
const flag = (name: string): string | undefined =>
  process.argv
    .find((arg) => arg.startsWith(`--${name}=`))
    ?.slice(name.length + 3);

const label = flag('label');
const context = flag('context');
const family = flag('family');
const levels = (flag('levels') ?? 'mid,senior')
  .split(',')
  .map((level) => `'${level.trim()}'`)
  .join(', ');

if (
  id === undefined ||
  !ROLE_ID_PATTERN.test(id) ||
  label === undefined ||
  !/^[A-Z][A-Za-z]+$/.test(label) ||
  (context === undefined) === (family === undefined)
) {
  writeLine(
    'usage: roles:new <id> --label=<Word> (--context=<c> | --family=<f>) [--levels=mid,senior]'
  );
  process.exit(1);
}

const catalogPath = join(ROLE_FILES_DIR, `${id}.ts`);
const briefPath = join(RESEARCH_DIR, `${id}.json`);
if (existsSync(catalogPath) || existsSync(briefPath)) {
  writeLine(`${id} already exists`);
  process.exit(1);
}

const cell =
  context === undefined
    ? `{ family: '${family ?? ''}', levels: [${levels}] }`
    : `{ context: '${context}', levels: [${levels}] }`;

writeFileSync(
  catalogPath,
  `import { defineRole } from '../define';

// Why this role exists: the segment, its size and what its postings and
// its market research ask for that the others do not.
export default defineRole({
  id: '${id}',
  label: '${label}',
  audience: 'TODO: who reads this presentation, in one phrase',
  description: 'TODO: what this segment is and what sets it apart.',
  cells: [${cell}],
  voice: {
    eyebrow: 'TODO',
    statement: 'TODO: the differentiator, in this reader’s words.',
    statementSecondary: 'TODO: scope and domains.',
    availability: 'TODO',
    sections: ['work', 'projects', 'agentic', 'proof', 'about', 'contact'],
    basedOn: [],
  },
});
`
);

writeFileSync(
  briefPath,
  `${JSON.stringify(
    {
      role: id,
      asOf: new Date().toISOString().slice(0, 10),
      summary: 'TODO',
      readers: [],
      criteria: [],
      redFlags: [],
      vocabulary: { prefer: [], avoid: [], verbs: [], titles: [] },
      resume: {
        pages: 1,
        summaryStyle: '',
        sectionOrder: [
          'summary',
          'experience',
          'projects',
          'skills',
          'education',
        ],
        bulletFormula: '',
        keywordStrategy: '',
        notes: [],
        sources: [0],
      },
      portfolio: { leadWith: '', mustHave: [], notes: [], sources: [0] },
      visual: {
        tone: '',
        scheme: 'auto',
        hue: 255,
        chroma: 'moderate',
        display: 'sans',
        accent: 'mono',
        corners: 'soft',
        density: 'comfortable',
        rationale: '',
        sources: [0],
      },
      interview: [],
      sources: [],
    },
    null,
    2
  )}\n`
);

writeLine(`wrote src/roles/by-id/${id}.ts`);
writeLine(`wrote src/market/research/${id}.json (fill it from cited research)`);
writeLine('next: fill both, then bun run roles:sync && bun run test');
