#!/usr/bin/env bun
/**
 * Print the state of the market → knowledge → presentation pipeline: one
 * compact report instead of three sets of source files. Read-only and
 * offline; it reads the committed landscape and the knowledge base.
 *
 * Usage (from packages/portfolio):
 *   bun run archetypes:status           # the report
 *   bun run archetypes:status --json    # the same, for a script or an agent
 *   bun run archetypes:status --check   # exit 1 when anything needs attention
 */
import { DEFAULT_ARCHETYPE_ID } from '../src/archetypes/definitions';
import { statusOf, type ArchetypeStatus } from '../src/archetypes/status';
import { THEMES } from '../src/knowledge/themes';
import { writeLine } from '../src/library/cli-output';

const flags = new Set(process.argv.slice(2));
const status = statusOf();

const percent = (value: number): string => `${(value * 100).toFixed(0)}%`;
const dollars = (value: number | null): string =>
  value === null ? 'n/a' : `$${String(Math.round(value / 1000))}k`;

const archetypeLines = (archetype: ArchetypeStatus): string[] => [
  `${archetype.id}${archetype.id === DEFAULT_ARCHETYPE_ID ? '  (default)' : ''}`,
  `  ${String(archetype.postings)} postings (${percent(archetype.share)} of sample) · fit ${percent(archetype.fit)} · opportunity ${archetype.opportunity.toFixed(2)} · median ${archetype.yearsMedian?.toFixed(0) ?? 'n/a'} yrs asked · ${dollars(archetype.salaryMedian)} posted`,
  `  asks for: ${archetype.topThemes.map((theme) => THEMES[theme]).join('; ')}`,
];

const report = (): string[] => [
  `Market landscape of ${status.landscapeDate} (${String(status.landscapeAgeDays)} days old)`,
  '',
  ...status.archetypes.flatMap((archetype) => [
    ...archetypeLines(archetype),
    '',
  ]),
  `Most-requested skills with no evidence in the knowledge base: ${status.skillGaps.map((gap) => `${gap.label} ${percent(gap.share)}`).join(', ')}`,
  '',
  status.actions.length === 0
    ? 'Nothing needs attention.'
    : `Needs attention:\n${status.actions.map((action) => `  - ${action}`).join('\n')}`,
];

writeLine(
  flags.has('--json') ? JSON.stringify(status, null, 2) : report().join('\n')
);
if (flags.has('--check') && status.actions.length > 0) process.exit(1);
