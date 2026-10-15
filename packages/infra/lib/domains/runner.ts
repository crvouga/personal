import { join } from 'node:path';
import { type HealthContext } from '../health/context.js';
import { reportExitCode, type HealthReport } from '../health/report.js';
import { migrationChecks } from './checks.js';
import { baseline, digest, directory, evidence, privateJson } from './files.js';
import { validateSpec, type DomainSpec, type Stage } from './model.js';
import { observe } from './observations.js';
import { migrationProgress } from './progress.js';

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

export async function requireGate(ctx: HealthContext, domain: string, stage: Stage): Promise<HealthReport> {
  const report = await check(ctx, domain, stage);
  if (migrationExitCode(report, ctx.config.domains![domain])) throw new Error(`${stage} gate blocked; run 'domains check ${domain} --stage ${stage}' for every finding. Required SKIP/WARN never pass`);
  return report;
}
