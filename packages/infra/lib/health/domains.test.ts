import { describe, expect, test } from 'bun:test';
import { checkDomains } from './check-domains.js';
import { fakeContext, fakeFetch } from './fixtures.test-support.js';
import { retainedRegistrar } from '../domains/checks.js';
import type { DomainSpec } from '../domains/model.js';

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
