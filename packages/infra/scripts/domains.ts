#!/usr/bin/env bun
/** Offline file generation, read-only probes, and guarded OpenTofu saved-plan execution. */
import { appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { errorMessage } from '../lib/health/context.js';
import { renderMarkdown, renderText, type HealthReport } from '../lib/health/report.js';
import { loadServicesConfig } from '../lib/services.js';
import { capture } from '../lib/domains/capture.js';
import { listZones } from '../lib/domains/cloudflare.js';
import { draft } from '../lib/domains/draft.js';
import { baseline, initialize } from '../lib/domains/files.js';
import { domainName, STAGES, type Stage } from '../lib/domains/model.js';
import { apply, plan } from '../lib/domains/plans.js';
import { check, migrationExitCode } from '../lib/domains/runner.js';
import { discover } from '../lib/domains/discover.js';
import { freeze, observe } from '../lib/domains/observations.js';
import { migrationContext } from '../lib/domains/runtime.js';
import { openOwnerBrowser } from '../lib/domains/owner-browser.js';
import { inspectOwnerBrowser } from '../lib/domains/owner-inspection.js';

const HELP = `Usage: bun run domains <command> [domain] [options]

  browser                          open regular Chrome with a private persistent owner profile (macOS)
  browser-inspect                  inspect that Chrome profile with scripts; block write requests
    --restart-browser              explicitly permit a graceful restart of only this dedicated Chrome
  inventory                        list inventory and all Cloudflare zones; compare Squarespace dashboard
  discover                         public delegation, DNS, RDAP and HTTPS observations for every domain
  init <domain>                    create ignored, private evidence templates (never overwrite)
  freeze <domain>                  record the start of an operator-enforced DNS change freeze
  observe <domain>                 start/reset DS absence and delegation soak timers automatically
  capture <domain>                 immutable complete baseline; Cloudflare GET or reviewed source export
  draft <domain>                   generate inventory candidate and declarative import IDs; never apply
  check <domain> --stage <stage>   run all stage gates, save report; any FAIL/WARN/SKIP exits 1
  watch <domain> --stage <stage>   repeat checks; exit 0 after three consecutive passes; bounded deadline
  plan <domain> --stage <stage> --plan <name.tfplan>
                                   fresh gates, encrypted saved foundation plan, scope/destroy guards
  apply <domain> --plan <name.tfplan> --reviewed-sha256 <digest>
                                   verify reviewed plan, rerun gates, tofu apply, post-checks

Stages: ${STAGES.join(', ')}. plan accepts source, forwarding, transfer or secure.
Options: --json; watch --interval-seconds <60..3600> --deadline-seconds <180..1209600>
Docs: packages/infra/docs/domain-migration.md
Registrar transfer plans are billable OpenTofu operations. Squarespace writes and email approvals require a supported owner access path.`;

type Args = { command: string; domain?: string; stage?: Stage; json: boolean; restartBrowser: boolean; name: string; reviewed: string; interval: number; deadline: number };

function parse(argv: string[]): Args {
  const command = argv.shift() ?? 'help';
  const domain = argv[0] && !argv[0].startsWith('--') ? domainName(argv.shift()!) : undefined;
  const args: Args = { command, domain, json: false, restartBrowser: false, name: '', reviewed: '', interval: 60, deadline: 3600 };
  while (argv.length) {
    const flag = argv.shift();
    if (flag === '--json') { args.json = true; continue; }
    if (flag === '--restart-browser' && command === 'browser-inspect') { args.restartBrowser = true; continue; }
    const value = argv.shift();
    if (!value || value.startsWith('--')) throw new Error(`${flag}: value required`);
    if (flag === '--stage' && STAGES.includes(value as Stage)) args.stage = value as Stage;
    else if (flag === '--plan') args.name = value;
    else if (flag === '--reviewed-sha256') args.reviewed = value;
    else if (flag === '--interval-seconds') args.interval = Number(value);
    else if (flag === '--deadline-seconds') args.deadline = Number(value);
    else throw new Error(`Unknown flag or stage: ${flag}`);
  }
  if (!Number.isInteger(args.interval) || args.interval < 60 || args.interval > 3600) throw new Error('Watch interval must be 60..3600 seconds');
  if (!Number.isInteger(args.deadline) || args.deadline < 180 || args.deadline > 1209600) throw new Error('Watch deadline must be 180..1209600 seconds');
  return args;
}

function output(report: HealthReport, json: boolean): void {
  console.log(json ? JSON.stringify(report) : renderText(report, { verbose: true, color: process.stdout.isTTY === true }));
  if (process.env['GITHUB_STEP_SUMMARY']) appendFileSync(process.env['GITHUB_STEP_SUMMARY'], renderMarkdown(report));
}

async function main(): Promise<number> {
  const args = parse(process.argv.slice(2));
  if (['help', '--help', '-h'].includes(args.command)) { console.log(HELP); return 0; }
  const config = loadServicesConfig();
  const repoRoot = join(import.meta.dirname, '..', '..', '..');
  if (args.command === 'browser') {
    const profile = openOwnerBrowser(repoRoot);
    console.log(`Opened the Squarespace domains dashboard in regular Chrome.\nPrivate persistent profile: ${profile}\nComplete sign-in in Chrome. This only opens the browser; no domain settings or infrastructure are changed.`);
    return 0;
  }
  if (args.command === 'browser-inspect') {
    const result = await inspectOwnerBrowser(repoRoot, args.domain ? [args.domain] : Object.keys(config.domains ?? {}), args.restartBrowser,
      (detail) => console.error(`[owner-browser] ${detail}`));
    console.log(args.json ? JSON.stringify(result) : `${result.status.toUpperCase()}: ${result.detail}${result.evidencePath ? `\nPrivate evidence: ${result.evidencePath}` : ''}`);
    return result.status === 'observed' ? 0 : 2;
  }
  const ctx = await migrationContext(repoRoot);
  if (args.command === 'discover') { console.log(JSON.stringify(await discover(ctx), null, 2)); return 0; }
  if (args.command === 'inventory') {
    const zones = await listZones(ctx);
    const result = { configured: Object.keys(config.domains ?? {}), cloudflare: zones,
      untrackedCloudflare: zones.filter((zone) => !config.domains?.[zone.name]).map((zone) => zone.name),
      squarespace: 'UNKNOWN: compare every domain in the Squarespace dashboard, including other accounts; public DNS cannot enumerate ownership' };
    console.log(JSON.stringify(result, null, 2));
    return result.untrackedCloudflare.length ? 1 : 0;
  }
  const domain = args.domain;
  if (!domain) throw new Error('Domain required');
  if (args.command === 'init') { console.log(initialize(repoRoot, domain)); return 0; }
  const spec = config.domains?.[domain];
  if (!spec) throw new Error('Add the domain to locals.inventory.domains first; see the runbook');
  if (args.command === 'freeze') { console.log(freeze(ctx, domain)); return 0; }
  if (args.command === 'observe') { await observe(ctx, domain); console.log('DS/delegation observations recorded; timers start only on verified observations'); return 0; }
  if (args.command === 'capture') { const snapshot = await capture(ctx, domain); console.log(`${snapshot.records.length} records captured from ${snapshot.source}; baseline is private and immutable`); return 0; }
  if (args.command === 'draft') { console.log(await draft(ctx, domain, spec, baseline(repoRoot, domain))); return 0; }
  if (args.command === 'plan') {
    if (args.stage !== 'source' && args.stage !== 'forwarding' && args.stage !== 'transfer' && args.stage !== 'secure') throw new Error('plan --stage source, forwarding, transfer or secure required');
    console.log(JSON.stringify(await plan(ctx, domain, args.stage, args.name), null, 2));
    return 0;
  }
  if (args.command === 'apply') { await apply(ctx, domain, args.name, args.reviewed); console.log('OpenTofu apply and post-checks passed'); return 0; }
  if (!['check', 'watch'].includes(args.command) || !args.stage) throw new Error('Use check/watch with an explicit --stage');
  const started = Date.now();
  let consecutive = 0;
  do {
    const report = await check(ctx, domain, args.stage);
    output(report, args.json);
    const code = migrationExitCode(report, spec);
    if (args.command === 'check') return code;
    consecutive = code === 0 ? consecutive + 1 : 0;
    if (consecutive >= 3) return 0;
    // Sleep in short increments so signal cancellation remains responsive.
    for (let elapsed = 0; elapsed < args.interval && Date.now() - started < args.deadline * 1000; elapsed++) {
      await Bun.sleep(1000);
    }
  } while (Date.now() - started < args.deadline * 1000);
  console.error('Deadline reached without three consecutive complete passes; migration remains blocked');
  return 1;
}

main().then((code) => { process.exitCode = code; }, (err) => { console.error(errorMessage(err)); process.exitCode = 1; });
