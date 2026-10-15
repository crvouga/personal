/** One-command, resumable preparation. Unsupported ownership operations fail closed. */
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { errorMessage, mapLimit, type HealthContext } from '../health/context.js';
import { capture } from './capture.js';
import { accountId, listRecords, listZones } from './cloudflare.js';
import { discover } from './discover.js';
import { baseline, directory, initialize, privateJson } from './files.js';
import { freeze, observe } from './observations.js';
import { validateSpec, type Zone } from './model.js';
import { checkDomains } from '../health/check-domains.js';
import { probe } from './checks.js';
import { effectiveRecords } from './forwarding.js';
import { parity } from './records.js';
import { verifyRecords } from './dns.js';
import { RESOLVERS } from './model.js';
import { migrationProgress } from './progress.js';

export type Blocker = { readonly domain: string; readonly code: string; readonly detail: string };
export type CampaignReport = {
  readonly status: 'blocked' | 'complete';
  readonly observedAt: string;
  readonly domains: number;
  readonly blockers: readonly Blocker[];
  readonly snapshots: readonly { domain: string; records: number; source: string }[];
};

async function toolBlockers(ctx: HealthContext): Promise<Blocker[]> {
  const blockers: Blocker[] = [];
  for (const [tool, args] of [['dig', ['-v']], ['tofu', ['version']]] as const) {
    const result = await ctx.run(tool, args, { timeoutMs: 10000 });
    if (result.code !== 0 || (tool === 'tofu' && !result.stdout.includes('OpenTofu v1.13.'))) blockers.push({ domain: '*', code: 'TOOL_REQUIRED', detail: `${tool}: requires ${tool === 'tofu' ? 'OpenTofu 1.13.0' : 'dig with TCP support'}` });
  }
  return blockers;
}

export function campaignComplete(domains: readonly string[], verified: readonly string[]): boolean {
  return domains.length > 0 && domains.every((domain) => verified.includes(domain));
}

async function prepareDomain(ctx: HealthContext, domain: string, zones: readonly Zone[], blockers: Blocker[]) {
  const spec = ctx.config.domains![domain];
  validateSpec(domain, spec);
  const dir = initialize(ctx.repoRoot, domain);
  if (!existsSync(join(dir, 'freeze.json'))) freeze(ctx, domain);
  if (!existsSync(join(dir, 'baseline.json'))) {
    try { await capture(ctx, domain); }
    catch (err) { blockers.push({ domain, code: 'SOURCE_BASELINE_REQUIRED', detail: errorMessage(err) }); }
  }
  let snapshot;
  if (existsSync(join(dir, 'baseline.json'))) {
    snapshot = baseline(ctx.repoRoot, domain);
    migrationProgress('dns-observations', 'Checking DNSSEC absence and delegation cache observations', domain);
    await observe(ctx, domain);
  }
  if (!zones.some((zone) => zone.name === domain)) blockers.push({ domain, code: 'DNS_ADOPTION_REQUIRED', detail: spec.dns_migration === 'retire-unused'
    ? 'No Cloudflare zone in the account; reviewed OpenTofu adoption of the canonical empty unused zone must precede delegation'
    : 'No Cloudflare zone in the account; complete source export and reviewed OpenTofu adoption must precede delegation' });
  migrationProgress('domain-verification', 'Checking registration, authoritative DNS and declared HTTPS endpoints', domain);
  const finalChecks = [...await checkDomains({ ...ctx, config: { ...ctx.config, domains: { [domain]: { ...spec, manage_registration: true } } } })];
  const zone = zones.find((zone) => zone.name === domain);
  if (zone && snapshot) {
    const expected = effectiveRecords(snapshot.records, spec);
    migrationProgress('baseline', 'Verifying complete DNS baseline and API record parity', domain);
    finalChecks.push(await probe(`${domain}: complete baseline preservation`, async () => {
      const issues = parity(expected, await listRecords(ctx, zone));
      if (issues.length) throw new Error(issues.join('; '));
      for (const server of [...zone.name_servers, ...RESOLVERS]) await verifyRecords(ctx, server, expected, true, RESOLVERS.some((resolver) => resolver === server), domain);
      return snapshot.source === 'retired-unused' ? 'Canonical empty target zone and authoritative SOA verified; old unused records intentionally retired' : `${expected.length} complete source records and API origins/settings verified`;
    }));
  }
  const verified = snapshot !== undefined && finalChecks.every((result) => result.status === 'pass' ||
    (spec.availability === 'best-effort' && result.status === 'warn' && result.name.includes('https://')));
  for (const result of finalChecks.filter((result) => result.status === 'fail')) blockers.push({ domain, code: 'FINAL_VERIFICATION_REQUIRED', detail: `${result.name}: ${result.detail}` });
  // Cloudflare initiation is implemented as an OpenTofu REST resource, but the
  // losing registrar's ownership operations cannot be inferred from DNS access.
  if (!verified) blockers.push({ domain, code: 'REGISTRATION_OR_DNS_INCOMPLETE', detail: 'Required final checks are incomplete. The executor can adopt DNS and submit an eligible Cloudflare transfer through OpenTofu; Squarespace owner operations require a supported authenticated access path' });
  return { verified, snapshot: snapshot ? { domain, records: snapshot.records.length, source: snapshot.source } : undefined };
}

export async function campaign(ctx: HealthContext): Promise<{ report: CampaignReport; path: string }> {
  const root = join(ctx.repoRoot, '.domain-migration');
  mkdirSync(root, { recursive: true, mode: 0o700 });
  // This entry point only reads remote state. Immutable evidence uses exclusive
  // writes and reports use unique filenames; interrupted runs need no lock cleanup.
    migrationProgress('tools', 'Checking dig and the pinned OpenTofu version');
    const blockers = await toolBlockers(ctx);
    let zones: readonly Zone[] = [];
    migrationProgress('cloudflare-zones', 'Listing Cloudflare account zones (read-only)');
    try { accountId(ctx); zones = await listZones(ctx); }
    catch (err) { blockers.push({ domain: '*', code: 'CLOUDFLARE_READ_ACCESS_REQUIRED', detail: errorMessage(err) }); }
    const snapshots: { domain: string; records: number; source: string }[] = [];
    const verified: string[] = [];
    if (!blockers.some((blocker) => ['TOOL_REQUIRED', 'CLOUDFLARE_READ_ACCESS_REQUIRED'].includes(blocker.code))) {
      const domains = Object.keys(ctx.config.domains ?? {});
      const prepared = await mapLimit(domains, 2, async (domain) => {
        migrationProgress('domain-check', `Starting domain checks (${domains.indexOf(domain) + 1}/${domains.length})`, domain);
        try { const result = await prepareDomain(ctx, domain, zones, blockers); if (result.verified) verified.push(domain); return result.snapshot; }
        catch (err) { blockers.push({ domain, code: 'PREPARATION_FAILED', detail: errorMessage(err) }); return undefined; }
      });
      snapshots.push(...prepared.filter((row) => row !== undefined));
    }
    const untracked = zones.filter((zone) => !ctx.config.domains?.[zone.name]);
    for (const zone of untracked) blockers.push({ domain: zone.name, code: 'UNTRACKED_ZONE', detail: 'Cloudflare account contains a domain absent from the canonical migration inventory' });
    const report: CampaignReport = {
      status: blockers.length === 0 && campaignComplete(Object.keys(ctx.config.domains ?? {}), verified) ? 'complete' : 'blocked', observedAt: ctx.now().toISOString(), domains: Object.keys(ctx.config.domains ?? {}).length,
      blockers: blockers.sort((a, b) => `${a.domain}:${a.code}`.localeCompare(`${b.domain}:${b.code}`)), snapshots,
    };
    const stamp = `${Date.now()}-${crypto.randomUUID()}`;
    const path = join(root, `campaign-${stamp}.json`);
    privateJson(path, report);
    if (!blockers.some((blocker) => blocker.code === 'TOOL_REQUIRED')) {
      migrationProgress('public-discovery', 'Collecting public DNS, RDAP and HTTPS observations (read-only)');
      privateJson(join(root, `public-discovery-${stamp}.json`), await discover(ctx));
    }
    return { report, path };
}
