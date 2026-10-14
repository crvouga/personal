import { describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fakeContext, fakeFetch } from '../health/fixtures.test-support.js';
import { fail, pass, skip, warn, type HealthReport } from '../health/report.js';
import { checkDomains } from '../health/check-domains.js';
import { absentDs, registrar, waited } from './checks.js';
import { listRecords } from './cloudflare.js';
import { answers, delegation, query, verifyRecords } from './dns.js';
import { initialize, privateJson } from './files.js';
import { effectiveRecords } from './forwarding.js';
import type { DnsRecord, DomainSpec } from './model.js';
import { apply, validatePlan } from './plans.js';
import { campaign, campaignComplete } from './campaign.js';
import { parseRecords, parity, rdata, settingsKey, txtValue } from './records.js';
import { migrationExitCode } from './runner.js';
import { capture } from './capture.js';
import { validateSpec } from './model.js';

const DOMAIN = 'example.dev';
const ADDRESS: DnsRecord = { name: DOMAIN, type: 'A', content: '192.0.2.1', ttl: 300, proxied: false };
const SPEC: DomainSpec = { availability: 'critical', dns_migration: 'preserve', manage_zone: false, records: {}, dnssec_status: 'disabled', manage_registration: false,
  settle_seconds: 172800, web_usage: 'required', forwarding_enabled: false, forwarding: [], https: [{ url: 'https://example.dev/', status: 200 }] };
const dig = (rows: string[], status = 'NOERROR', flags = 'qr aa'): string => `;; ->>HEADER<<- opcode: QUERY, status: ${status}, id: 1\n;; flags: ${flags}; QUERY: 1\n${rows.join('\n')}\n`;
const ctxForDns = (answer: (server: string, name: string, type: string) => string) => fakeContext({
  run: async (command, argv) => { expect(command).toBe('dig'); return { code: 0, stderr: '', stdout: answer(argv[0].slice(1), argv[1], argv[2]) }; },
});
const change = (address: string, actions: string[], after = {}, before = {}) => ({ address, change: { actions, after, before } });

describe('DNS preservation', () => {
  test('TXT chunking, spaces, case and DNS escapes preserve DKIM/SPF bytes', () => {
    expect(txtValue('"AbC\\032def" "\\034G\\034"')).toBe('AbC def"G"');
    expect(rdata({ ...ADDRESS, type: 'TXT', content: '"AbC" "def"' })).toBe('AbCdef');
    expect(parity([{ ...ADDRESS, type: 'TXT', content: 'AbC' }], [{ ...ADDRESS, type: 'TXT', content: 'abc' }])).not.toEqual([]);
  });
  test('equivalent IPv6 and dotted targets compare, but priority, TTL and proxy changes block', () => {
    expect(parity([{ ...ADDRESS, type: 'AAAA', content: '2001:0db8::1' }], [{ ...ADDRESS, type: 'AAAA', content: '2001:db8:0:0:0:0:0:1' }])).toEqual([]);
    for (const changed of [{ ...ADDRESS, ttl: 1 }, { ...ADDRESS, proxied: true }]) expect(parity([ADDRESS], [changed])).not.toEqual([]);
    expect(parity([{ ...ADDRESS, type: 'MX', content: 'Mail.Example.dev.', priority: 10 }], [{ ...ADDRESS, type: 'MX', content: 'mail.example.dev', priority: 20 }])).not.toEqual([]);
  });
  test('lost siblings and unreviewed additional records never pass', () => {
    expect(parity([ADDRESS, { ...ADDRESS, content: '192.0.2.2' }], [ADDRESS])).toHaveLength(1);
    expect(parity([ADDRESS], [ADDRESS, ADDRESS])).toHaveLength(1);
  });
  test('unknown types and private routes fail rather than producing lossy IaC', () => {
    expect(() => parseRecords([{ ...ADDRESS, type: 'HTTPS' }], DOMAIN)).toThrow('explicit provider mapping');
    expect(() => parseRecords([{ ...ADDRESS, private_routing: true }], DOMAIN)).toThrow('Private routing');
    expect(() => parseRecords([{ ...ADDRESS, name: 'other.dev' }], DOMAIN)).toThrow('outside');
    expect(() => parseRecords([{ ...ADDRESS, type: 'MX', priority: undefined }], DOMAIN)).toThrow('priority');
  });
  test('MX probe compares the entire RRset, not one matching exchange', async () => {
    const ctx = ctxForDns(() => dig([`${DOMAIN}. 300 IN MX 10 mx1.example.dev.`]));
    await expect(verifyRecords(ctx, 'ns.example.dev', [
      { ...ADDRESS, type: 'MX', content: 'mx1.example.dev', priority: 10 },
      { ...ADDRESS, type: 'MX', content: 'mx2.example.dev', priority: 20 },
    ], false)).rejects.toThrow('RRset differs');
  });
  test('SERVFAIL is an error even when dig exits zero', async () => {
    await expect(query(ctxForDns(() => dig([], 'SERVFAIL')), '1.1.1.1', DOMAIN, 'NS', true)).rejects.toThrow('SERVFAIL');
  });
  test('record verification refuses a recursive answer masquerading as an authority', async () => {
    const ctx = ctxForDns(() => dig([`${DOMAIN}. 300 IN A 192.0.2.1`], 'NOERROR', 'qr rd ra'));
    await expect(verifyRecords(ctx, 'ns.example.dev', [ADDRESS], false)).rejects.toThrow('not authoritative');
  });
  test('an empty unused target must still serve its own authoritative SOA', async () => {
    const missing = ctxForDns(() => dig(['dev. 300 IN SOA ns.dev. hostmaster.dev. 1 2 3 4 60'], 'NXDOMAIN'));
    await expect(verifyRecords(missing, 'ns.example.dev', [], true, false, DOMAIN)).rejects.toThrow('no authoritative SOA');
    const healthy = ctxForDns(() => dig([`${DOMAIN}. 300 IN SOA ns.example.dev. hostmaster.example.dev. 1 2 3 4 60`]));
    await expect(verifyRecords(healthy, 'ns.example.dev', [], true, false, DOMAIN)).resolves.toBeUndefined();
  });
  test('retirement of an unused source requires no invented export, and critical domains cannot choose it', async () => {
    expect(() => validateSpec(DOMAIN, { ...SPEC, dns_migration: 'retire-unused' })).toThrow('Critical DNS');
    const repo = mkdtempSync(join(tmpdir(), 'unused-retirement-'));
    try {
      initialize(repo, DOMAIN);
      const dnsCtx = ctxForDns((_, name, type) => name === 'dev'
        ? dig(['dev. 86400 IN NS ns.registry.dev.'])
        : type === 'NS' ? dig([`${DOMAIN}. 172800 IN NS ns1.source.dev.`, `${DOMAIN}. 172800 IN NS ns2.source.dev.`], 'NOERROR', 'qr')
        : dig([`${name}. 300 IN SOA ns1.source.dev. hostmaster.source.dev. 1 2 3 4 60`]));
      const ctx = { ...dnsCtx, repoRoot: repo, config: { ...dnsCtx.config, domains: { [DOMAIN]: { ...SPEC, availability: 'best-effort' as const, dns_migration: 'retire-unused' as const } } },
        env: { CF_API_TOKEN: 'test', CLOUDFLARE_ACCOUNT_ID: 'a'.repeat(32) },
        fetch: fakeFetch({ [`https://api.cloudflare.com/client/v4/zones?account.id=${'a'.repeat(32)}&per_page=50&page=1`]: { body: { success: true, result: [], result_info: { total_pages: 1 } } } }) };
      const result = await capture(ctx, DOMAIN);
      expect(result.source).toBe('retired-unused');
      expect(result.records).toEqual([]);
      expect(result.sourceWarnings?.join(' ')).toContain('not enumerated or backed up');
    } finally { rmSync(repo, { recursive: true, force: true }); }
  });
  test('parent referral NS is accepted and all parent views must agree', async () => {
    const ctx = ctxForDns((server, name) => name === 'dev'
      ? dig(['dev. 86400 IN NS ns1.registry.dev.', 'dev. 86400 IN NS ns2.registry.dev.'])
      : dig([`${DOMAIN}. 172800 IN NS ${server === 'ns1.registry.dev' ? 'ns1.example.dev' : 'ns2.example.dev'}.`], 'NOERROR', 'qr'));
    await expect(delegation(ctx, DOMAIN)).rejects.toThrow('inconsistent');
  });
  test('stale DS on either validating resolver blocks cutover', async () => {
    const ctx = ctxForDns((server, name, type) => name === 'dev'
      ? dig(['dev. 86400 IN NS ns1.registry.dev.'])
      : type === 'DS' && server === '8.8.8.8'
        ? dig([`${DOMAIN}. 86400 IN DS 12345 13 2 DEADBEEF`])
        : dig(['dev. 3600 IN SOA ns.registry.dev. hostmaster.registry.dev. 1 2 3 4 300']));
    await expect(absentDs(ctx, DOMAIN)).rejects.toThrow('DS still');
  });
  test('negative DS response without authoritative denial proof cannot pass', async () => {
    const ctx = ctxForDns((_, name) => name === 'dev' ? dig(['dev. 86400 IN NS ns1.registry.dev.']) : dig([]));
    await expect(absentDs(ctx, DOMAIN)).rejects.toThrow('negative-answer proof');
  });
  test('capture pagination includes every record and sends only authenticated GETs', async () => {
    let requests = 0;
    const ctx = fakeContext({ env: { CF_API_TOKEN: 'private-test-token' }, fetch: (async (_url, init) => {
      expect(init?.method).toBe('GET');
      requests++;
      return Response.json({ success: true, result: [{ ...ADDRESS, content: `192.0.2.${requests}` }], result_info: { total_pages: 2 } });
    }) as typeof fetch });
    expect(await listRecords(ctx, { id: 'test-zone', name: DOMAIN, status: 'active', name_servers: [] })).toHaveLength(2);
    expect(requests).toBe(2);
  });
});

describe('migration gates and plan safety', () => {
  test('timestamps must be real, in the past, and beyond the full cache wait', () => {
    const now = new Date('2026-10-14T00:00:00Z');
    for (const since of ['', 'not-a-date', '2026-10-15T00:00:00Z', '2026-10-13T00:00:00Z']) expect(() => waited(now, since, 172800, 'DS')).toThrow();
    expect(() => waited(now, '2026-10-12T00:00:00Z', 172800, 'DS')).not.toThrow();
  });
  test('unused-site warnings are advisory, but required DNSSEC failures and missing evidence block every domain', () => {
    const report: HealthReport = { zone: DOMAIN, startedAt: '', durationMs: 0, groups: [
      { id: 'domains', title: '', durationMs: 0, results: [pass('DNSSEC', 'checked')] },
      { id: 'availability', title: '', durationMs: 0, results: [warn('HTTPS', 'broken')] },
    ] };
    expect(migrationExitCode(report, SPEC)).toBe(1);
    expect(migrationExitCode(report, { ...SPEC, availability: 'best-effort' })).toBe(0);
    for (const result of [fail('DNSSEC', 'DS still present'), skip('credential', 'missing')]) {
      expect(migrationExitCode({ ...report, groups: [report.groups[1], { ...report.groups[0], results: [result] }] }, { ...SPEC, availability: 'best-effort' })).toBe(1);
    }
  });
  test('unrelated changes, replacements, deletions and unrelated imports are blocked', () => {
    for (const item of [change('railway_service.live', ['update']), change('cloudflare_zone.primary', ['delete', 'create']), change('cloudflare_zone.primary', ['delete']),
      { address: 'railway_service.live', change: { actions: ['no-op'], importing: { id: 'existing' } } }]) {
      expect(() => validatePlan({ resource_changes: [item] }, DOMAIN, 'source', [settingsKey(ADDRESS)])).toThrow();
    }
    expect(() => validatePlan({ resource_changes: [change('cloudflare_zone_dnssec.primary', ['update'], { status: 'active' })] }, DOMAIN, 'secure', [])).toThrow('Unrelated');
  });
  test('staging cannot sneak in proxy changes, new records or DNSSEC activation', () => {
    const address = `cloudflare_dns_record.domain["${DOMAIN}:a"]`;
    expect(() => validatePlan({ resource_changes: [change(address, ['create'], { ...ADDRESS, proxied: true })] }, DOMAIN, 'source', [settingsKey(ADDRESS)])).toThrow('differs');
    expect(() => validatePlan({ resource_changes: [change(`cloudflare_zone_dnssec.domain["${DOMAIN}"]`, ['create'], { status: 'active' })] }, DOMAIN, 'source', [])).toThrow('Do not enable');
    expect(validatePlan({ resource_changes: [change(address, ['create'], ADDRESS)] }, DOMAIN, 'source', [settingsKey(ADDRESS)])).toHaveLength(1);
  });
  test('forwarding changes only the explicit host proxy flag and TTL', () => {
    const record = { ...ADDRESS, name: 'www.example.dev' };
    const spec: DomainSpec = { ...SPEC, forwarding_enabled: true, forwarding: [{ hostname: DOMAIN, target: 'https://destination.dev', status: 301, preserve_path: true, preserve_query: false }] };
    expect(effectiveRecords([ADDRESS, record], spec)).toEqual([{ ...ADDRESS, ttl: 1, proxied: true }, record]);
    expect(() => effectiveRecords([record], spec)).toThrow('existing source address');
  });
  test('missing credentials are skipped and never counted as a successful account verification', async () => {
    const results = await checkDomains(fakeContext({ config: { ...fakeContext().config, domains: { [DOMAIN]: SPEC } }, env: {} }));
    expect(results.map((result) => result.status)).toEqual(['skip']);
  });
  test('RDAP ownership alone cannot pass a still-pending Cloudflare registration', async () => {
    const ctx = fakeContext({ env: { CF_API_TOKEN: 'test', CLOUDFLARE_ACCOUNT_ID: 'a'.repeat(32) }, fetch: fakeFetch({
      [`https://rdap.org/domain/${DOMAIN}`]: { body: { status: [], entities: [{ roles: ['registrar'], publicIds: [{ type: 'IANA Registrar ID', identifier: '1910' }] }] } },
      [`https://api.cloudflare.com/client/v4/accounts/${'a'.repeat(32)}/registrar/registrations/${DOMAIN}`]: { body: { success: true, result: { domain_name: DOMAIN, status: 'transfer_pending', locked: true, auto_renew: true } } },
    }) });
    await expect(registrar(ctx, DOMAIN, true)).rejects.toThrow('not active');
  });
  test('private backups cannot be overwritten and templates start with no attested evidence', () => {
    const repo = mkdtempSync(join(tmpdir(), 'domain-migration-test-'));
    try {
      const dir = initialize(repo, DOMAIN);
      expect(statSync(join(dir, 'operator.json')).mode & 0o777).toBe(0o600);
      expect(Object.values(JSON.parse(readFileSync(join(dir, 'operator.json'), 'utf8'))).every((v) => v === '')).toBe(true);
      expect(() => privateJson(join(dir, 'operator.json'), { overwritten: true })).toThrow();
      expect(() => initialize(repo, '../../escape')).toThrow();
    } finally { rmSync(repo, { recursive: true, force: true }); }
  });
  test('a missing credential blocks the one-command campaign without a stale lock or an apply', async () => {
    const repo = mkdtempSync(join(tmpdir(), 'domain-campaign-test-'));
    try {
      const ctx = fakeContext({ repoRoot: repo, config: { ...fakeContext().config, domains: { [DOMAIN]: SPEC } }, env: {},
        run: async (command, args) => {
          if (command === 'tofu') { expect(args).toEqual(['version']); return { code: 0, stdout: 'OpenTofu v1.13.0', stderr: '' }; }
          return { code: 0, stdout: dig([]), stderr: '' };
        }, fetch: fakeFetch({}) });
      const { report } = await campaign(ctx);
      expect(report.status).toBe('blocked');
      expect(report.blockers.some((blocker) => blocker.code === 'CLOUDFLARE_READ_ACCESS_REQUIRED')).toBe(true);
      expect(() => statSync(join(repo, '.domain-migration/campaign.lock'))).toThrow();
      expect(campaignComplete([DOMAIN, 'other.dev'], [DOMAIN])).toBe(false);
      expect(campaignComplete([], [])).toBe(false);
      expect(campaignComplete([DOMAIN], [DOMAIN])).toBe(true);
    } finally { rmSync(repo, { recursive: true, force: true }); }
  });
  test('an encrypted plan with the wrong reviewed hash cannot reach OpenTofu or a network probe', async () => {
    const repo = mkdtempSync(join(tmpdir(), 'domain-plan-test-'));
    try {
      const dir = initialize(repo, DOMAIN);
      privateJson(join(dir, 'test.tfplan'), { encryptedFixture: true });
      privateJson(join(dir, 'test.tfplan.json'), { domain: DOMAIN, purpose: 'source', sha256: 'f'.repeat(64) });
      const ctx = fakeContext({ repoRoot: repo, run: async () => { throw new Error('must never run'); }, fetch: fakeFetch({}) });
      await expect(apply(ctx, DOMAIN, 'test.tfplan', '0'.repeat(64))).rejects.toThrow('SHA-256 mismatch');
    } finally { rmSync(repo, { recursive: true, force: true }); }
  });
});
