import { describe, expect, test } from 'bun:test';
import { checkDomains } from './check-domains.js';
import { fakeContext, fakeFetch } from './fixtures.test-support.js';
import { retainedRegistrar } from '../domains/checks.js';
import type { DomainSpec } from '../domains/model.js';
import { sslMode } from '../domains/cloudflare.js';

test('origin TLS policy is read from Cloudflare without mutations or credential fallback', async () => {
  const zone = { id: 'zone-id', name: 'application.app', status: 'active', name_servers: [] };
  const seen: string[] = [];
  const ctx = fakeContext({ env: { CLOUDFLARE_API_TOKEN: 'fixture-only' }, fetch: fakeFetch({
    'https://api.cloudflare.com/client/v4/zones/zone-id/settings/ssl': { body: { success: true, result: { value: 'full' } } },
  }, seen) });
  expect(await sslMode(ctx, zone)).toBe('full');
  expect(seen).toEqual(['https://api.cloudflare.com/client/v4/zones/zone-id/settings/ssl']);
  await expect(sslMode({ ...ctx, env: {} }, zone)).rejects.toThrow('required');
});

const domain = 'example.dev';
const spec: DomainSpec = {
  availability: 'best-effort', domain_manager: 'squarespace', registrar_iana_id: '895', nameservers: ['ns1.example.net', 'ns2.example.net'],
  manage_zone: false, dnssec_status: 'disabled', records: {}, web_usage: 'none', https: [],
};
const registrar = (name = 'Squarespace Domains II LLC.', status = ['client transfer prohibited'], id = '895') => ({
  ldhName: domain, status, entities: [{ roles: ['registrar'], publicIds: [{ type: 'IANA Registrar ID', identifier: id }], vcardArray: ['vcard', [['fn', {}, 'text', name]]] }],
});
const routes = (doc: unknown) => ({
  'https://data.iana.org/rdap/dns.json': { body: { services: [[['dev'], ['https://rdap.example/']]] } },
  [`https://rdap.example/domain/${domain}`]: { body: doc },
});

describe('retained Squarespace domains', () => {
  test('accepts locked Squarespace registration and rejects transfers or another registrar', async () => {
    for (const name of ['Squarespace Domains LLC', 'Squarespace Domains II LLC.']) {
      await expect(retainedRegistrar(fakeContext({ config: { ...fakeContext().config, domains: { [domain]: spec } }, fetch: fakeFetch(routes(registrar(name))) }), domain)).resolves.toContain('transfer locked');
    }
    for (const doc of [registrar('Cloudflare, Inc.', undefined, '1910'), registrar(undefined, ['pendingTransfer']), registrar(undefined, [])]) {
      await expect(retainedRegistrar(fakeContext({ config: { ...fakeContext().config, domains: { [domain]: spec } }, fetch: fakeFetch(routes(doc)) }), domain)).rejects.toThrow();
    }
  });

  test('public registration and delegation checks run without Cloudflare credentials', async () => {
    const seen: string[] = [];
    const ctx = fakeContext({
      config: { ...fakeContext().config, zone: 'other.dev', domains: { [domain]: spec } },
      env: {}, fetch: fakeFetch(routes(registrar()), seen),
      run: async (_command, args) => {
        const name = args[1], type = args[2];
        const records = type === 'NS' ? (name === 'dev' ? ['parent.example.net'] : spec.nameservers).map((server) => `${name}. 3600 IN NS ${server}.`).join('\n') : 'dev. 3600 IN SOA parent.example.net. hostmaster.example.net. 1 2 3 4 5';
        return { code: 0, stdout: `;; status: NOERROR\n;; flags: qr aa;\n${records}\n`, stderr: '' };
      },
    });
    const results = await checkDomains(ctx);
    expect(results.find((row) => row.name === `${domain}: registration`)?.status).toBe('pass');
    expect(results.find((row) => row.name === `${domain}: existing delegation`)?.status).toBe('pass');
    expect(results.some((row) => row.status === 'fail' || row.status === 'skip')).toBe(false);
    expect(seen.some((url) => url.includes('api.cloudflare.com'))).toBe(false);
  });

  test('unavailable RDAP is a failure, never proof of retained ownership', async () => {
    const ctx = fakeContext({ fetch: fakeFetch({ 'https://data.iana.org/rdap/dns.json': { status: 503 } }) });
    await expect(retainedRegistrar(ctx, domain)).rejects.toThrow('RDAP bootstrap HTTP 503');
  });

  test('retains the existing Tucows registrar behind a Squarespace reseller account', async () => {
    const ctx = fakeContext({
      config: { ...fakeContext().config, domains: { [domain]: { ...spec, registrar_iana_id: '69' } } },
      fetch: fakeFetch(routes(registrar('Tucows Domains Inc', undefined, '69'))),
    });
    await expect(retainedRegistrar(ctx, domain)).resolves.toContain('Tucows Domains Inc');
  });
});

describe('dig transient failures', () => {
  type Run = (args: readonly string[]) => Promise<{ code: number; stdout: string; stderr: string }>;
  const nsReply = (name: string) => {
    const servers = name === 'dev' ? ['parent.example.net'] : spec.nameservers;
    return { code: 0, stdout: `;; status: NOERROR\n;; flags: qr aa;\n${servers.map((server) => `${name}. 3600 IN NS ${server}.`).join('\n')}\n`, stderr: '' };
  };
  const delegationResult = async (run: Run, retries = 2) => {
    const calls: string[] = [];
    const base = fakeContext();
    const ctx = fakeContext({
      config: { ...base.config, zone: 'other.dev', domains: { [domain]: spec } },
      options: { ...base.options, retries, retryDelayMs: 0 },
      fetch: fakeFetch(routes(registrar())),
      run: async (_command, args) => { calls.push(args.join(' ')); return run(args); },
    });
    const results = await checkDomains(ctx);
    return { calls, row: results.find((result) => result.name === `${domain}: existing delegation`) };
  };

  test('exit 9 once, then a real answer, passes', async () => {
    let dropped = false;
    const { row } = await delegationResult(async (args) => {
      if (!dropped) { dropped = true; return { code: 9, stdout: '', stderr: ';; no servers could be reached' }; }
      return nsReply(args[1]);
    });
    expect(row?.status).toBe('pass');
  });

  test('exit 9 on every attempt still fails and says the resolver was unreachable', async () => {
    const { calls, row } = await delegationResult(async () => ({ code: 9, stdout: '', stderr: '' }));
    expect(row?.status).toBe('fail');
    expect(row?.detail).toContain('resolver unreachable after 3 attempts');
    expect(row?.detail).toContain('dig failed (9)');
    expect(calls.length).toBeGreaterThanOrEqual(3);
  });

  test('a real negative answer is not retried', async () => {
    const run: Run = async () => ({ code: 0, stdout: ';; status: SERVFAIL\n;; flags: qr;\n', stderr: '' });
    const { calls, row } = await delegationResult(run);
    expect(row?.status).toBe('fail');
    expect(row?.detail).toContain('SERVFAIL');
    expect(calls.length).toBe((await delegationResult(run, 0)).calls.length);
  });

  test('other dig failures are not retried', async () => {
    const run: Run = async () => ({ code: 1, stdout: '', stderr: 'usage' });
    const { calls, row } = await delegationResult(run);
    expect(row?.status).toBe('fail');
    expect(row?.detail).toContain('dig failed (1)');
    expect(calls.length).toBe((await delegationResult(run, 0)).calls.length);
  });
});
