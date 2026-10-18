// `bun run health:fix` — `bun run health`, but interactive. It runs the same
// checks, then walks the failures: guided fixers (confirmed one by one, always
// through OpenTofu or CI) where one exists, a pointer where it doesn't, and
// finally re-checks what it touched.
//
//   bun run health:fix [--only ids] [--skip ids] [--drift] [--dry-run] [--env-file FILE]
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_HEALTH_OPTIONS } from '../packages/infra/lib/health/context';
import { createHealthContext } from '../packages/infra/lib/health/ports';
import {
  renderText,
  reportCounts,
  reportExitCode,
  type HealthReport,
} from '../packages/infra/lib/health/report';
import {
  runHealth,
  selectGroups,
  type HealthGroup,
} from '../packages/infra/lib/health/run';
import { loadServicesConfig } from '../packages/infra/lib/services';
import { ADVICE, fixers } from './health-fix/registry';
import { findingsOf, triage } from './health-fix/triage';
import { confirm } from './vault-inputs/prompt';
import { parseEnv } from './vault-secrets-tfvars';

const repoRoot = join(import.meta.dirname, '..');
const color = process.stdout.isTTY && !process.env['NO_COLOR'];

function list(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);
}

function parseArgs(argv: string[]) {
  const value = (flag: string) => {
    const at = argv.indexOf(flag);
    if (at < 0) return undefined;
    const next = argv[at + 1];
    if (!next) throw new Error(`${flag} needs a value`);
    return next;
  };
  const file = value('--env-file');
  return {
    only: list(value('--only')),
    skip: list(value('--skip')),
    drift: argv.includes('--drift'),
    dryRun: argv.includes('--dry-run'),
    given: file ? parseEnv(readFileSync(file, 'utf8')) : {},
  };
}

async function check(
  groups: readonly HealthGroup[],
  drift: boolean
): Promise<HealthReport> {
  const ctx = createHealthContext({
    config: loadServicesConfig(),
    repoRoot,
    options: { ...DEFAULT_HEALTH_OPTIONS, drift },
  });
  console.error(`Checking ${groups.map((group) => group.id).join(', ')}…`);
  return runHealth(ctx, groups);
}

const show = (report: HealthReport) =>
  console.log(renderText(report, { verbose: false, color }));

async function main(): Promise<number> {
  if (!process.stdin.isTTY)
    throw new Error(
      'Run this in an interactive terminal (or use `bun run health`).'
    );
  const args = parseArgs(process.argv.slice(2));
  const groups = selectGroups(args.only, args.skip);
  const report = await check(groups, args.drift);
  show(report);

  const { fixes, manual } = triage(findingsOf(report), fixers(args), ADVICE);
  const touched = new Set<string>();
  for (const { fixer, findings } of fixes) {
    console.log(`\n▸ ${fixer.title}`);
    for (const finding of findings)
      console.log(`    ${finding.group}: ${finding.check} — ${finding.detail}`);
    if (!(await confirm('Fix this now?'))) continue;
    await fixer.run(findings);
    for (const finding of findings) touched.add(finding.group);
  }

  if (manual.length) {
    console.log('\nNeeds manual action:');
    for (const { finding, advice } of manual)
      console.log(`  ${finding.group}: ${finding.check}\n    → ${advice}`);
  }
  if (touched.size === 0) return reportExitCode(report, false);

  if (!(await confirm('\nRe-check the groups you fixed?'))) return 0;
  const after = await check(
    groups.filter((group) => touched.has(group.id)),
    args.drift
  );
  show(after);
  const { fail } = reportCounts(after);
  console.log(
    fail === 0
      ? '\n✓ Fixed groups are healthy. Some CI-driven fixes only show after CI finishes; re-run `bun run health:fix` then.'
      : `\n✗ ${fail} check(s) still failing. CI-driven fixes (e.g. generated Vault fields) appear after the re-run CI finishes.`
  );
  return reportExitCode(after, false);
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(
      `\n✗ ${error instanceof Error ? error.message : String(error)}`
    );
    process.exit(1);
  }
);
