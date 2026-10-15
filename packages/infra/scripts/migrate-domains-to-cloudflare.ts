#!/usr/bin/env bun
import { join } from 'node:path';
import { errorMessage } from '../lib/health/context.js';
import { campaignLock } from '../lib/domains/lock.js';
import { migrate, type MigrationUpdate } from '../lib/domains/migration.js';
import { migrationContext } from '../lib/domains/runtime.js';
import { migrationProgress, progressLine, withMigrationProgress } from '../lib/domains/progress.js';

const HELP = `Usage: bun migrate-domains-to-cloudflare [--audit | --once] [--json]
  Default: prepare, adopt DNS, review/apply scoped saved OpenTofu plans,
  submit eligible transfers once, secure completed registrations, verify all 14.
  Automatically waits for DNS cache timers and pending registrar workflows.
  --audit  read-only remote checks and private preparation; no infrastructure writes
  --once   advance every available stage once; do not stay polling
  --interval-seconds <60..3600>  default 60
  --deadline-seconds <60+>      optional foreground polling deadline
  --json   machine-readable stage/heartbeat events and reports (JSON lines)
  Prints stages immediately and a heartbeat every 15 seconds during long work.
Exits 2 for unresolved prerequisites/owner actions, 0 only for verified completion.
Squarespace unlock/EPP/delegation need supported authenticated owner access.
Docs: packages/infra/docs/domain-migration.md`;

function output(value: MigrationUpdate, json: boolean): void {
  if (json) { console.log(JSON.stringify(value)); return; }
  const { report, automation } = value;
  console.log(`Domain migration ${report.status.toUpperCase()}: ${report.domains} domains; ${report.snapshots.length} saved observations.\nReport: ${value.reportPath}\nExact remaining actions: ${value.nextActionsPath}`);
  for (const action of automation.actions) console.log(`DONE: ${action}`);
  for (const row of automation.progress) {
    console.log(`${row.domain}: ${row.state.toUpperCase()} — ${row.detail}`);
    for (const finding of row.findings ?? []) console.log(`  ${finding}`);
  }
  for (const blocker of report.blockers) console.log(`${blocker.domain}: ${blocker.code} — ${blocker.detail}`);
  if (automation.progress.some((row) => row.state === 'waiting')) console.log('Monitoring verified waits; this foreground process must remain running.');
}

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  if (args.includes('--help')) { console.log(HELP); return 0; }
  let audit = false, once = false, json = false, intervalSeconds = 60;
  let deadlineSeconds: number | undefined;
  while (args.length) {
    const flag = args.shift();
    if (flag === '--audit') audit = true;
    else if (flag === '--once') once = true;
    else if (flag === '--json') json = true;
    else if (flag === '--interval-seconds' && args.length) intervalSeconds = Number(args.shift());
    else if (flag === '--deadline-seconds' && args.length) deadlineSeconds = Number(args.shift());
    else throw new Error(`Unknown option: ${flag}`);
  }
  const repo = join(import.meta.dirname, '..', '..', '..');
  const release = campaignLock(repo);
  const stop = new AbortController();
  const interrupt = () => { console.error('Stopping after the current safe operation; saved state and receipts remain resumable.'); stop.abort(); };
  process.once('SIGINT', interrupt);
  process.once('SIGTERM', interrupt);
  try {
    return await withMigrationProgress((event) => {
      if (json) console.log(JSON.stringify(event));
      else console.error(progressLine(event));
    }, async () => {
      migrationProgress('credentials', 'Loading existing credentials and private OpenTofu inputs');
      const result = await migrate(await migrationContext(repo), { audit, once, intervalSeconds, deadlineSeconds }, (value) => output(value, json), stop.signal);
      return result.report.status === 'complete' ? 0 : 2;
    });
  } finally {
    process.removeListener('SIGINT', interrupt);
    process.removeListener('SIGTERM', interrupt);
    release();
  }
}

main().then((code) => { process.exitCode = code; }, (err) => { console.error(errorMessage(err)); process.exitCode = 2; });
