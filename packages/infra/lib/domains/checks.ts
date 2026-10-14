import { asRecord, asStrings, errorMessage, mapLimit, type HealthContext } from '../health/context.js';
import { fail, pass, skip, warn, type CheckResult } from '../health/report.js';
import { dnssec, findZone, listRecords, registration } from './cloudflare.js';
import { answers, delegation, parents, query, sameSet, verifyRecords } from './dns.js';
import { normalizeName, RESOLVERS, validateSpec, type DomainSpec, type OperatorEvidence, type Snapshot, type Stage, type Zone } from './model.js';
import { parity } from './records.js';
import { effectiveRecords, forwardingCertificate } from './forwarding.js';
import { transferPreflight } from './transfers.js';

export async function probe(name: string, task: () => Promise<string>): Promise<CheckResult> {
  try { return pass(name, await task()); }
  catch (err) { return fail(name, errorMessage(err)); }
}

export function waited(now: Date, since: string, seconds: number, label: string): void {
  const time = Date.parse(since);
  if (!Number.isFinite(time) || time > now.getTime()) throw new Error(`${label}: missing, invalid or future observation timestamp; real elapsed time is required`);
  if (now.getTime() - time < seconds * 1000) throw new Error(`${label}: wait until ${new Date(time + seconds * 1000).toISOString()} (${seconds} seconds from the verified observation)`);
}

function requireEvidence(value: string, label: string): void {
  if (value.trim().length < 12 || /^(todo|pending|n\/a|true|yes)$/i.test(value.trim())) {
    throw new Error(`${label}: record dated findings and supporting evidence, or an explicit reason why inapplicable`);
  }
}

function ownerReview(label: string, value: string, limitation: string): CheckResult {
  try { requireEvidence(value, label); return pass(`Owner review: ${label}`, 'Owner findings recorded; see private evidence'); }
  catch { return skip(`Owner review: ${label}`, `${limitation}; no owner finding is claimed. Advisory review does not replace mandatory API/DNS/service checks`); }
}

async function https(ctx: HealthContext, spec: DomainSpec): Promise<CheckResult[]> {
  if (spec.web_usage === 'none') return [pass('HTTPS coverage', 'Inventory explicitly declares no web service to exercise')];
  if (!spec.https.length) return [skip('HTTPS coverage', 'No endpoints declared; document non-web use and add applicable probes before a gate can pass')];
  return mapLimit(spec.https, 4, (endpoint) => probe(`HTTPS ${endpoint.url}`, async () => {
    const response = await ctx.fetch(endpoint.url, { method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(ctx.options.coldStartTimeoutMs) });
    await response.body?.cancel();
    if (response.status !== endpoint.status) throw new Error(`expected ${endpoint.status}, got ${response.status}`);
    if (endpoint.location && response.headers.get('location') !== endpoint.location) throw new Error('redirect Location changed');
    const cert = await ctx.certificate(new URL(endpoint.url).hostname);
    if (!cert.authorized || cert.validTo.getTime() < ctx.now().getTime() + ctx.options.certificateWarnDays * 86400000) {
      throw new Error('certificate is untrusted or expires inside the safety window');
    }
    return 'expected status/redirect and trusted TLS';
  }));
}

export async function absentDs(ctx: HealthContext, domain: string): Promise<string> {
  for (const server of [...await parents(ctx, domain), ...RESOLVERS]) {
    const recursive = RESOLVERS.some((value) => value === server);
    const reply = await query(ctx, server, domain, 'DS', recursive);
    if (!recursive && !reply.authoritative) throw new Error(`${server}: parent DS absence is not authoritative`);
    if (answers(reply, domain, 'DS').length) throw new Error(`${server}: parent DS still published/cached; do not change nameservers or signers`);
    if (!reply.records.some((record) => record.type === 'SOA' || record.type === 'NSEC' || record.type === 'NSEC3')) {
      throw new Error(`${server}: DNSSEC absence has no negative-answer proof`);
    }
  }
  return 'DS absent at every parent authority and both validating resolvers';
}

async function delegatedTo(ctx: HealthContext, domain: string, zone: Zone): Promise<string> {
  const expected = zone.name_servers.map(normalizeName);
  if (!sameSet((await delegation(ctx, domain)).servers, expected)) throw new Error('Parent delegation differs from exact account-assigned Cloudflare nameservers');
  for (const server of RESOLVERS) {
    if (!sameSet(answers(await query(ctx, server, domain, 'NS', true), domain, 'NS').map((r) => normalizeName(r.value)), expected)) {
      throw new Error(`${server}: cached NS differs from Cloudflare assignment`);
    }
  }
  if (zone.status !== 'active') throw new Error(`Cloudflare zone status ${zone.status}; expected active`);
  return 'parent authorities, recursive resolvers and Cloudflare agree';
}

/** RDAP is advisory before transfer, authoritative registration plus API is required afterwards. */
export async function rdap(ctx: HealthContext, domain: string): Promise<Record<string, unknown>> {
  const response = await ctx.fetch(`https://rdap.org/domain/${domain}`, { method: 'GET', redirect: 'follow', signal: AbortSignal.timeout(ctx.options.timeoutMs) });
  if (!response.ok) throw new Error(`RDAP HTTP ${response.status}`);
  return asRecord(await response.json());
}

export async function registrar(ctx: HealthContext, domain: string, complete: boolean, secured = true): Promise<string> {
  const doc = await rdap(ctx, domain);
  const statuses = asStrings(doc.status).map((s) => s.toLowerCase());
  if (statuses.some((s) => /hold|redemption|pending delete/.test(s))) throw new Error('RDAP indicates hold, redemption or deletion');
  if (complete) {
    const entities = Array.isArray(doc.entities) ? doc.entities.map(asRecord) : [];
    const cloudflare = entities.some((entity) => asStrings(entity.roles).includes('registrar') &&
      Array.isArray(entity.publicIds) && entity.publicIds.some((id) => asRecord(id).identifier === '1910'));
    if (!cloudflare) throw new Error('RDAP registrar is not Cloudflare (IANA 1910)');
    const reg = await registration(ctx, domain);
    if (reg.domain_name !== domain || reg.status !== 'active' || !reg.created_at || !reg.expires_at) throw new Error('Cloudflare registration is not active/ready for this domain');
    if (secured && (reg.locked !== true || reg.auto_renew !== true)) throw new Error('Registrar lock and auto-renew must both be enabled');
    if (secured && reg.privacy_mode !== 'redaction') throw new Error('WHOIS privacy redaction must be enabled');
    return secured ? 'RDAP Cloudflare registrar, transfer complete, locked and auto-renewing' : 'RDAP and Cloudflare confirm completed transfer';
  }
  if (statuses.some((s) => /transfer prohibited|pending transfer/.test(s))) throw new Error('RDAP transfer lock or transfer already pending; resolve before initiating');
  const events = Array.isArray(doc.events) ? doc.events.map(asRecord) : [];
  const expiry = events.find((event) => event.eventAction === 'expiration');
  if (!expiry || Date.parse(String(expiry.eventDate)) < ctx.now().getTime() + 30 * 86400000) throw new Error('Expiration must be verified and at least 30 days away; renew first if necessary');
  for (const event of events.filter((e) => ['registration', 'transfer'].includes(String(e.eventAction)))) {
    waited(ctx.now(), String(event.eventDate), 60 * 86400, `RDAP ${event.eventAction} lock window`);
  }
  return 'RDAP has no transfer lock/hold and sufficient expiration runway; review TLD/contact locks separately';
}

export async function migrationChecks(ctx: HealthContext, domain: string, spec: DomainSpec, snapshot: Snapshot, operator: OperatorEvidence, stage: Stage): Promise<CheckResult[]> {
  validateSpec(domain, spec);
  if (spec.availability === 'critical' && (!snapshot.records.length || !spec.https.length || spec.web_usage !== 'required')) throw new Error('Critical domains require DNS records and HTTPS coverage');
  const results = await https(ctx, spec);
  // An unenumerated external source is unsafe. A complete authenticated source
  // already supplies machine evidence; do not require redundant sign-off text.
  if (snapshot.source === 'operator-export') results.push(await probe('Source export review', async () => {
    requireEvidence(operator.sourceReview, 'sourceReview');
    return 'reviewed complete source export';
  }));
  if (['cutover', 'forwarding', 'transfer', 'secure', 'complete'].includes(stage)) {
    results.push(ownerReview('accountRecoveryReview', operator.accountRecoveryReview, 'Independent account recovery/MFA cannot be tested with the available API'));
    if (spec.dns_migration !== 'retire-unused') results.push(ownerReview('dependenciesReview', operator.dependenciesReview, 'Non-DNS dependencies are not independently inventoried; full source DNS and declared services remain mandatory'));
  }
  if (stage === 'source') {
    if (snapshot.source === 'retired-unused') {
      results.push(warn('Source DNS retirement', 'Old unused records are deliberately retired under canonical policy; no complete source-zone backup is claimed'));
      return results;
    }
    results.push(...await mapLimit(snapshot.sourceNameservers, 4, (server) => probe(`Source DNS @${server}`, async () => {
      await verifyRecords(ctx, server, snapshot.records, snapshot.source === 'cloudflare', false, domain);
      return 'source RRsets match immutable baseline';
    })));
    return results;
  }
  const zone = await findZone(ctx, domain);
  const expected = effectiveRecords(snapshot.records, spec, stage === 'forwarding' ? false : spec.forwarding_enabled);
  results.push(await probe('Cloudflare full record parity', async () => {
    if (snapshot.zone && zone.id !== snapshot.zone.id) throw new Error('Cloudflare zone identity changed from the immutable source baseline');
    const issues = parity(expected, await listRecords(ctx, zone));
    if (issues.length) throw new Error(issues.join('; '));
    return `${snapshot.records.length} records; RDATA, TTL, proxy and settings preserved`;
  }));
  const servers = stage === 'baseline' || stage === 'cutover'
    ? [...new Set([...snapshot.sourceNameservers, ...zone.name_servers])]
    : [...zone.name_servers, ...RESOLVERS];
  results.push(...await mapLimit(servers, 4, (server) => probe(`${snapshot.sourceNameservers.includes(server) && !zone.name_servers.includes(server) ? 'Source DNS' : 'DNS records'} @${server}`, async () => {
    if (snapshot.source === 'retired-unused' && snapshot.sourceNameservers.includes(server) && !zone.name_servers.includes(server)) return 'Source records explicitly retired; no historical RRset preservation is claimed';
    const recursive = RESOLVERS.some((r) => r === server);
    const cf = zone.name_servers.includes(server) || recursive || snapshot.source === 'cloudflare';
    const expectedRecords = snapshot.sourceNameservers.includes(server) && !zone.name_servers.includes(server) ? snapshot.records : expected;
    await verifyRecords(ctx, server, expectedRecords, cf, recursive, domain);
    return 'all RRsets match (proxy/flattened origins checked through API parity)';
  })));
  if (stage === 'baseline') return results;
  results.push(await probe('DNS freeze and cache wait', async () => {
    waited(ctx.now(), operator.freezeStartedAt, Math.max(snapshot.maxObservedTtl, spec.settle_seconds), 'freezeStartedAt');
    if (Date.parse(operator.freezeStartedAt) > Date.parse(snapshot.capturedAt)) throw new Error('Freeze must start before baseline capture');
    return 'freeze predates baseline and old positive/negative/delegation TTL wait elapsed';
  }));
  if (stage !== 'complete') {
    results.push(await probe('DNSSEC removal and cache wait', async () => {
      await absentDs(ctx, domain);
      waited(ctx.now(), operator.dsAbsentSince, Math.max(snapshot.maxObservedTtl, spec.settle_seconds), 'dsAbsentSince');
      const status = await dnssec(ctx, zone);
      if (status.status !== 'disabled') throw new Error('Cloudflare DNSSEC must be disabled through OpenTofu until transfer completes');
      return 'parent DS absent, old DS TTL wait elapsed, target DNSSEC disabled';
    }));
  }
  if (stage === 'cutover') return results;
  results.push(await probe('Delegation convergence', () => delegatedTo(ctx, domain, zone)));
  results.push(await probe('Delegation soak', async () => {
    waited(ctx.now(), operator.delegationChangedAt, Math.max(snapshot.maxObservedTtl, spec.settle_seconds), 'delegationChangedAt');
    return 'Cloudflare delegation has soaked beyond old TTLs';
  }));
  if (stage === 'forwarding') {
    results.push(await probe('Forwarding certificate readiness', () => forwardingCertificate(ctx, zone, spec)));
    return results;
  }
  if (stage === 'dns-live') return results;
  if (spec.forwarding.length && !spec.forwarding_enabled) results.push(fail('Forwarding', 'Enable and verify Cloudflare forwarding before transferring registration'));
  results.push(await probe('Registrar', () => registrar(ctx, domain, stage === 'complete' || stage === 'secure', stage !== 'secure')));
  if (stage === 'transfer') results.push(await probe('Transfer API and duplicate prevention', () => transferPreflight(ctx, domain)));
  results.push(ownerReview('transferEligibilityReview', operator.transferEligibilityReview, 'Separate fee/contact review is unavailable; RDAP, extension support, authorized EPP and the actual transfer result are checked automatically'));
  results.push(ownerReview('billingReview', operator.billingReview, 'Payment settings are not independently inspected; Cloudflare must accept payment/transfer and report active registration before completion'));
  if (spec.dns_migration !== 'retire-unused') results.push(ownerReview('mailRoundTripReview', operator.mailRoundTripReview, 'No test email was sent; complete MX/TXT/source record preservation is mandatory'));
  if (stage === 'complete') results.push(ownerReview('retirementReview', operator.retirementReview, 'Subscriptions/account closure are not performed; verified registration/DNS migration does not claim account cancellation'));
  if (stage === 'complete') results.push(await probe('Final DNSSEC', async () => {
    const status = await dnssec(ctx, zone);
    if (status.status !== spec.dnssec_status) throw new Error('DNSSEC API differs from inventory');
    if (spec.dnssec_status === 'disabled') return absentDs(ctx, domain);
    const expectedDs = String(status.ds ?? '').replace(/\s+/g, ' ').toUpperCase();
    if (!expectedDs) throw new Error('Cloudflare DS unavailable');
    for (const server of [...await parents(ctx, domain), ...RESOLVERS]) {
      const reply = await query(ctx, server, domain, 'DS', RESOLVERS.some((r) => r === server));
      const got = answers(reply, domain, 'DS').map((r) => r.value.replace(/\s+/g, ' ').toUpperCase());
      if (!sameSet(got, [expectedDs])) throw new Error(`${server}: DS differs from Cloudflare signer`);
    }
    for (const server of RESOLVERS) {
      if (!(await query(ctx, server, domain, 'SOA', true)).authenticated) throw new Error(`${server}: DNSSEC validation (AD) absent`);
    }
    return 'matching parent DS and validated DNSSEC on both recursive resolvers';
  }));
  return results;
}
