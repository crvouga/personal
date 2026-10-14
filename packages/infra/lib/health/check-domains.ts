/** Always-on, read-only registration/delegation monitoring; no private migration files. */
import { mapLimit, type HealthContext } from './context.js';
import { fail, skip, type CheckResult } from './report.js';
import { absentDs, probe, registrar } from '../domains/checks.js';
import { dnssec, listZones, listRecords } from '../domains/cloudflare.js';
import { answers, delegation, query, sameSet, verifyRecords } from '../domains/dns.js';
import { normalizeName, RESOLVERS, validateSpec } from '../domains/model.js';
import { settingsKey } from '../domains/records.js';

export async function checkDomains(ctx: HealthContext): Promise<readonly CheckResult[]> {
  const domains = Object.entries(ctx.config.domains ?? {});
  if (!domains.length) return [skip('Domain inventory', 'No domains declared; enumerate Squarespace dashboard and compare Cloudflare zones')];
  if (!(ctx.env['CF_API_TOKEN'] || ctx.env['TF_VAR_cloudflare_api_token'] || ctx.env['CLOUDFLARE_API_TOKEN'])) {
    return [skip('Domain account verification', 'CF_API_TOKEN or TF_VAR_cloudflare_api_token required; no registrar/delegation checks passed')];
  }
  if (!(ctx.env['CLOUDFLARE_ACCOUNT_ID'] || ctx.env['TF_VAR_cloudflare_account_id'])) {
    return [skip('Domain account verification', 'CLOUDFLARE_ACCOUNT_ID or TF_VAR_cloudflare_account_id required')];
  }
  const zones = await listZones(ctx);
  return (await mapLimit(domains, 2, async ([domain, spec]): Promise<CheckResult[]> => {
    const results: CheckResult[] = [];
    try {
      validateSpec(domain, spec);
      const zone = zones.find((candidate) => candidate.name === domain);
      if (!zone && !spec.manage_zone) return [skip(domain, 'Zone staging not enabled; run the domain migration workflow')];
      if (!zone) throw new Error('Managed zone is missing from the account');
      results.push(await probe(`${domain}: delegation`, async () => {
        if (zone.status !== 'active') throw new Error(`zone is ${zone.status}; migration still pending`);
        const expected = zone.name_servers.map(normalizeName);
        if (!sameSet((await delegation(ctx, domain)).servers, expected)) throw new Error('parent NS differ from account-assigned Cloudflare NS');
        for (const server of RESOLVERS) {
          const names = answers(await query(ctx, server, domain, 'NS', true), domain, 'NS').map((r) => normalizeName(r.value));
          if (!sameSet(names, expected)) throw new Error(`${server}: stale or incorrect delegation`);
        }
        return 'exact parent and recursive Cloudflare nameservers match';
      }));
      results.push(await probe(`${domain}: declared records`, async () => {
        const live = await listRecords(ctx, zone);
        const declared = Object.values(spec.records);
        const keys = live.map(settingsKey);
        for (const record of declared) if (!keys.includes(settingsKey(record))) throw new Error(`${record.type} ${record.name}: API differs from inventory`);
        for (const server of RESOLVERS) await verifyRecords(ctx, server, declared, true, true, domain);
        return `${declared.length} migration records checked; primary service records also covered by DNS group and OpenTofu drift`;
      }));
      results.push(await probe(`${domain}: DNSSEC`, async () => {
        const status = await dnssec(ctx, zone);
        if (status.status !== spec.dnssec_status) throw new Error('DNSSEC status differs from inventory');
        if (spec.dnssec_status === 'disabled') return absentDs(ctx, domain);
        const expected = String(status.ds ?? '').replace(/\s+/g, ' ').toUpperCase();
        if (!expected) throw new Error('Cloudflare DS unavailable');
        for (const server of RESOLVERS) {
          const reply = await query(ctx, server, domain, 'DS', true);
          const values = answers(reply, domain, 'DS').map((record) => record.value.replace(/\s+/g, ' ').toUpperCase());
          if (!sameSet(values, [expected]) || !(await query(ctx, server, domain, 'SOA', true)).authenticated) throw new Error(`${server}: DS mismatch or DNSSEC validation absent`);
        }
        return 'DS matches signer and validating resolvers authenticate the zone';
      }));
      if (spec.manage_registration) results.push(await probe(`${domain}: registration`, () => registrar(ctx, domain, true)));
      else results.push(skip(`${domain}: registration`, 'Transfer not declared complete; use domains check --stage transfer/secure/complete'));
      for (const endpoint of spec.https) {
        const result = await probe(`${domain}: ${endpoint.url}`, async () => {
        const response = await ctx.fetch(endpoint.url, { redirect: 'manual', signal: AbortSignal.timeout(ctx.options.coldStartTimeoutMs) });
        await response.body?.cancel();
        if (response.status !== endpoint.status || (endpoint.location && response.headers.get('location') !== endpoint.location)) throw new Error('HTTPS status or redirect differs from inventory');
        const cert = await ctx.certificate(new URL(endpoint.url).hostname);
        if (!cert.authorized || cert.validTo.getTime() < ctx.now().getTime() + ctx.options.certificateWarnDays * 86400000) throw new Error('TLS is untrusted or near expiry');
        return 'expected HTTPS response and trusted certificate';
        });
        results.push(spec.availability === 'best-effort' && result.status === 'fail' ? { ...result, status: 'warn', detail: `${result.detail}; availability is advisory for this unused domain` } : result);
      }
    } catch (err) {
      results.push(fail(domain, err instanceof Error ? err.message : 'Domain check failed'));
    }
    return results;
  })).flat();
}
