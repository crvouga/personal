#!/usr/bin/env bun
import { join } from 'node:path';
import { errorMessage } from '../lib/health/context.js';
import { campaign } from '../lib/domains/campaign.js';
import { migrationContext } from '../lib/domains/runtime.js';

async function main(): Promise<number> {
  if (process.argv.includes('--help')) {
    console.log('Usage: bun migrate-domains-to-cloudflare [--json]\nResumes private preparation for all 14 domains; reuses Vault auth. Exits 2 for unresolved access/provider blockers, 0 only for verified completion. See packages/infra/docs/domain-migration.md.');
    return 0;
  }
  if (process.argv.slice(2).some((arg) => arg !== '--json')) throw new Error('Only --json and --help are accepted');
  const ctx = await migrationContext(join(import.meta.dirname, '..', '..', '..'));
  const { report, path } = await campaign(ctx);
  if (process.argv.includes('--json')) console.log(JSON.stringify({ ...report, reportPath: path }, null, 2));
  else {
    console.log(`Domain migration ${report.status.toUpperCase()}: ${report.domains} domains, ${report.snapshots.length} observations saved (${report.snapshots.filter((row) => row.source !== 'retired-unused').length} complete record baselines).\nReport: ${path}`);
    for (const blocker of report.blockers) console.log(`${blocker.domain}: ${blocker.code} — ${blocker.detail}`);
    console.log('No registrar transfer or live DNS change was attempted. Unsupported steps remain blocked.');
  }
  return report.status === 'complete' ? 0 : 2;
}

main().then((code) => { process.exitCode = code; }, (err) => { console.error(errorMessage(err)); process.exitCode = 2; });
