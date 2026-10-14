import { asRecord, asStrings, type HealthContext } from '../health/context.js';
import { cfGet } from './cloudflare.js';
import type { DnsRecord, DomainSpec, Zone } from './model.js';

/** The only intentional DNS transformation: proxy an existing forwarding address. */
export function effectiveRecords(records: readonly DnsRecord[], spec: DomainSpec, enabled = spec.forwarding_enabled): readonly DnsRecord[] {
  if (!enabled) return records;
  for (const redirect of spec.forwarding) {
    const matches = records.filter((r) => r.name === redirect.hostname && ['A', 'AAAA', 'CNAME'].includes(r.type));
    if (!matches.length) throw new Error(`${redirect.hostname}: forwarding needs an existing source address/CNAME; do not invent one`);
  }
  return records.map((record) => spec.forwarding.some((r) => r.hostname === record.name) && ['A', 'AAAA', 'CNAME'].includes(record.type)
    ? { ...record, proxied: true, ttl: 1 } : record);
}

export async function forwardingCertificate(ctx: HealthContext, zone: Zone, spec: DomainSpec): Promise<string> {
  const body = await cfGet(ctx, `/zones/${zone.id}/ssl/certificate_packs?status=active`);
  if (!Array.isArray(body.result)) throw new Error('Certificate pack response unavailable');
  const packs = body.result.map(asRecord).filter((pack) => pack.status === 'active');
  for (const redirect of spec.forwarding) {
    if (!packs.some((pack) => asStrings(pack.hosts).some((host) => host === redirect.hostname ||
      (host.startsWith('*.') && redirect.hostname.split('.').length === host.split('.').length && redirect.hostname.endsWith(host.slice(1)))))) {
      throw new Error(`${redirect.hostname}: no active Cloudflare edge certificate; keep DNS-only forwarding until issuance completes`);
    }
  }
  return 'active Cloudflare edge certificates cover every forwarding hostname';
}
