import { join } from 'node:path';
import { asRecord, errorMessage, type HealthContext } from '../health/context.js';
import { listRecords, listZones } from './cloudflare.js';
import { delegation, parents, query, sameSet, verifyRecords } from './dns.js';
import { directory, evidence, privateJson, readJson } from './files.js';
import { normalizeName, validateSpec, type Snapshot } from './model.js';
import { parseRecords } from './records.js';

/** Capture only observations; never use a public DNS scan as a complete zone export. */
export async function capture(ctx: HealthContext, domain: string): Promise<Snapshot> {
  const spec = ctx.config.domains?.[domain];
  if (!spec) throw new Error('Domain must be declared in the canonical inventory');
  validateSpec(domain, spec);
  const delegated = await delegation(ctx, domain);
  const zones = await listZones(ctx);
  const zone = zones.find((zone) => zone.name === domain);
  const fromCloudflare = zone !== undefined && sameSet(delegated.servers, zone.name_servers.map(normalizeName));
  const retire = !fromCloudflare && ctx.config.domains?.[domain]?.dns_migration === 'retire-unused';
  const records = fromCloudflare
    ? await listRecords(ctx, zone!)
    : retire ? [] : parseRecords(asRecord(readJson(join(directory(ctx.repoRoot, domain), 'source-records.json'))).records, domain);
  if (!records.length && ctx.config.domains?.[domain]?.availability === 'critical') throw new Error('Critical domains require a nonempty verified source inventory');
  if (!fromCloudflare && !retire && !evidence(ctx.repoRoot, domain).sourceReview.trim()) {
    throw new Error('sourceReview: enumerate every source DNS row, wildcard, mail/DKIM selector, delegation, glue and managed preset first');
  }
  let maxObservedTtl = Math.max(delegated.maxTtl, ...records.map((record) => record.ttl));
  const warnings: string[] = [];
  if (retire) warnings.push('Owner explicitly retires unused DNS and forwarding. Historical source records were not enumerated or backed up; target desired records come from the canonical empty inventory.');
  for (const server of await parents(ctx, domain)) {
    const ds = await query(ctx, server, domain, 'DS');
    maxObservedTtl = Math.max(maxObservedTtl, ...ds.records.map((record) => record.ttl));
  }
  for (const server of delegated.servers) {
    try {
      await verifyRecords(ctx, server, records, fromCloudflare, false, domain);
      const soa = await query(ctx, server, domain, 'SOA');
      if (!soa.authoritative || !soa.records.some((record) => record.type === 'SOA')) throw new Error(`${server}: SOA is not authoritative/present`);
      maxObservedTtl = Math.max(maxObservedTtl, ...soa.records.map((record) =>
        record.type === 'SOA' ? Math.max(record.ttl, Number(record.value.split(/\s+/).at(-1))) : record.ttl));
    } catch (err) {
      if (ctx.config.domains?.[domain]?.availability !== 'best-effort') throw err;
      warnings.push(errorMessage(err));
      maxObservedTtl = Math.max(maxObservedTtl, 172800);
    }
  }
  const snapshot: Snapshot = {
    version: 1, domain, capturedAt: ctx.now().toISOString(),
    source: fromCloudflare ? 'cloudflare' : retire ? 'retired-unused' : 'operator-export',
    sourceNameservers: delegated.servers, records, maxObservedTtl,
    ...(zone ? { zone } : {}),
    ...(warnings.length ? { sourceWarnings: warnings } : {}),
  };
  privateJson(join(directory(ctx.repoRoot, domain), 'baseline.json'), snapshot);
  return snapshot;
}
