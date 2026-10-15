import { join } from 'node:path';
import { type HealthContext } from '../health/context.js';
import { reportExitCode, type HealthReport } from '../health/report.js';
import { migrationChecks } from './checks.js';
import { baseline, digest, directory, evidence, privateJson } from './files.js';
import { validateSpec, type DomainSpec, type Stage } from './model.js';
import { observe } from './observations.js';
import { migrationProgress } from './progress.js';
import { findZone } from './cloudflare.js';

/** Owner review notes are advisory; every actual required probe must pass. */
export function migrationExitCode(report: HealthReport, spec: DomainSpec): number {
  const required = report.groups.filter((group) => group.id !== 'owner-review' && (spec.availability !== 'best-effort' || group.id !== 'availability'));
  return reportExitCode({ ...report, groups: required }, true);
}

export async function check(ctx: HealthContext, domain: string, stage: Stage): Promise<HealthReport> {
  const spec = ctx.config.domains?.[domain];
  if (!spec) throw new Error(`${domain}: add this domain to locals.inventory.domains first`);
  validateSpec(domain, spec);
  migrationProgress('gate', `Checking ${stage} migration prerequisites`, domain);
  const start = ctx.now();
  const snapshot = baseline(ctx.repoRoot, domain);
  if (stage !== 'source') await observe(ctx, domain);
  const operator = evidence(ctx.repoRoot, domain);
  const results = await migrationChecks(ctx, domain, spec, snapshot, operator, stage);
  const optional = (name: string) => /^(HTTPS |Source DNS )/.test(name);
  const ownerReview = results.filter((result) => result.name.startsWith('Owner review: '));
  const availability = results.filter((result) => optional(result.name));
  const mandatory = results.filter((result) => !optional(result.name) && !result.name.startsWith('Owner review: '));
  const report: HealthReport = {
    zone: domain, startedAt: start.toISOString(), durationMs: ctx.now().getTime() - start.getTime(),
    groups: [
      { id: 'domains', title: `Domain migration: ${stage}`, durationMs: ctx.now().getTime() - start.getTime(), results: mandatory },
      { id: 'availability', title: `Service availability (${spec.availability})`, durationMs: 0,
        results: availability.map((result) => spec.availability === 'best-effort' && result.status === 'fail'
          ? { ...result, status: 'warn', detail: `${result.detail}; user accepts interruption for this domain` } : result) },
      { id: 'owner-review', title: 'Optional owner findings (not independently tested)', durationMs: 0, results: ownerReview },
    ],
  };
  privateJson(join(directory(ctx.repoRoot, domain), `report-${stage}-${Date.now()}-${crypto.randomUUID()}.json`), {
    ...report, stage, inventoryHash: digest(ctx.config), baselineHash: digest(snapshot), operatorHash: digest(operator),
  });
  return report;
}

const GATE_PORTS = { check, findZone, sleep: (ms: number) => Bun.sleep(ms) };

export function requiredFindings(report: HealthReport, ctx: HealthContext, domain: string): string[] {
  return report.groups.filter((group) => group.id !== 'owner-review' && (ctx.config.domains![domain].availability !== 'best-effort' || group.id !== 'availability'))
    .flatMap((group) => group.results.filter((result) => result.status !== 'pass').map((result) => `${result.name}: ${result.detail}`));
}

/** A newly created empty zone can briefly refuse DNS while its API already exists. */
async function pendingSourceDns(ctx: HealthContext, domain: string, report: HealthReport, ports: typeof GATE_PORTS): Promise<boolean> {
  const spec = ctx.config.domains![domain];
  if (spec.availability !== 'best-effort' || !spec.manage_zone || spec.existing_zone_id || Object.keys(spec.records).length) return false;
  const snapshot = baseline(ctx.repoRoot, domain);
  if (snapshot.source !== 'retired-unused' || snapshot.records.length) return false;
  if (!report.groups.some((group) => group.results.some((result) => result.name === 'Cloudflare full record parity' && result.status === 'pass'))) return false;
  const failures = report.groups.filter((group) => group.id !== 'owner-review' && group.id !== 'availability')
    .flatMap((group) => group.results.filter((result) => result.status !== 'pass'));
  if (!failures.length || !failures.every((result) => result.status === 'fail' && result.name.startsWith('DNS records @') && result.detail.endsWith(` SOA ${domain}: REFUSED`))) return false;
  const zone = await ports.findZone(ctx, domain);
  return zone.name === domain && zone.status === 'pending' && failures.every((result) => zone.name_servers.includes(result.name.slice('DNS records @'.length)));
}

export async function requireGate(ctx: HealthContext, domain: string, stage: Stage, appliedSource = false, ports = GATE_PORTS): Promise<HealthReport> {
  for (let attempt = 0; ; attempt++) {
    const report = await ports.check(ctx, domain, stage);
    if (!migrationExitCode(report, ctx.config.domains![domain])) return report;
    // Only callers with a successful source apply/receipt can enable this.
    // Every other prerequisite still fails immediately; no write is retried.
    if (!appliedSource || stage !== 'baseline' || attempt >= 11 || !await pendingSourceDns(ctx, domain, report, ports)) {
      throw new Error(`${stage} gate blocked; run 'domains check ${domain} --stage ${stage}' for every finding. Required SKIP/WARN never pass`);
    }
    migrationProgress('dns-propagation', `New pending Cloudflare zone still returns REFUSED; rechecking DNS in 5 seconds (${attempt + 1}/11 waits, read-only)`, domain);
    await ports.sleep(5000);
  }
}
