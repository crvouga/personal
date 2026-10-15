import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fakeContext } from '../health/fixtures.test-support.js';
import { fail, pass, skip, type HealthReport } from '../health/report.js';
import { initialize, privateJson } from './files.js';
import type { DomainSpec, Snapshot } from './model.js';
import { requireGate } from './runner.js';

const DOMAIN = 'unused.dev';
const NS = 'assigned.ns.cloudflare.com';
const SPEC: DomainSpec = { availability: 'best-effort', dns_migration: 'retire-unused', manage_zone: true, records: {}, dnssec_status: 'disabled', manage_registration: false,
  settle_seconds: 172800, web_usage: 'none', forwarding_enabled: false, forwarding: [], https: [], transfer_enabled: false };
const snapshot: Snapshot = { version: 1, domain: DOMAIN, source: 'retired-unused', capturedAt: '2026-10-01T00:00:00Z', records: [], sourceNameservers: ['old1.example.dev', 'old2.example.dev'], maxObservedTtl: 172800 };
const health = (...results: ReturnType<typeof pass>[]): HealthReport => ({ zone: DOMAIN, startedAt: '', durationMs: 0, groups: [{ id: 'domains', title: '', durationMs: 0, results }] });
const refused = () => health(pass('Cloudflare full record parity', 'empty API record set verified'), fail(`DNS records @${NS}`, `DNS ${NS} SOA ${DOMAIN}: REFUSED`));

function fixture() {
  const repoRoot = mkdtempSync(join(tmpdir(), 'source-propagation-'));
  const dir = initialize(repoRoot, DOMAIN);
  privateJson(join(dir, 'baseline.json'), snapshot);
  const ctx = fakeContext({ repoRoot, config: { ...fakeContext().config, domains: { [DOMAIN]: SPEC } } });
  return { ctx, clean: () => rmSync(repoRoot, { recursive: true, force: true }) };
}

describe('new Cloudflare zone propagation', () => {
  test('successful source apply waits only for real authoritative DNS, without repeating a write', async () => {
    const { ctx, clean } = fixture();
    try {
      let reads = 0, sleeps = 0;
      const ports = {
        check: async () => ++reads < 3 ? refused() : health(pass('DNS records', 'authoritative SOA verified')),
        findZone: async () => ({ id: 'zone', name: DOMAIN, status: 'pending', name_servers: [NS] }),
        sleep: async (ms: number) => { expect(ms).toBe(5000); sleeps++; },
      };
      await expect(requireGate(ctx, DOMAIN, 'baseline', true, ports)).resolves.toBeDefined();
      expect(reads).toBe(3);
      expect(sleeps).toBe(2);
    } finally { clean(); }
  });

  test('refused answers never pass, and waiting is bounded', async () => {
    const { ctx, clean } = fixture();
    try {
      let reads = 0, sleeps = 0;
      await expect(requireGate(ctx, DOMAIN, 'baseline', true, {
        check: async () => { reads++; return refused(); },
        findZone: async () => ({ id: 'zone', name: DOMAIN, status: 'pending', name_servers: [NS] }),
        sleep: async () => { sleeps++; },
      })).rejects.toThrow('gate blocked');
      expect(reads).toBe(12);
      expect(sleeps).toBe(11);
    } finally { clean(); }
  });

  test('no apply proof, critical/existing zones, parity failures, missing evidence and unrelated DNS errors fail immediately', async () => {
    const { ctx, clean } = fixture();
    try {
      for (const row of [
        { applied: false }, { stage: 'dns-live' as const }, { spec: { ...SPEC, availability: 'critical' as const } },
        { spec: { ...SPEC, existing_zone_id: 'existing' } }, { status: 'active' }, { servers: ['different.ns.cloudflare.com'] },
        { report: health(fail('Cloudflare full record parity', 'missing record'), ...refused().groups[0].results.slice(1)) },
        { report: health(skip('Required access', 'unavailable'), ...refused().groups[0].results) },
        { report: health(fail(`DNS records @${NS}`, `DNS ${NS} SOA ${DOMAIN}: SERVFAIL`)) },
      ]) {
        let sleeps = 0;
        await expect(requireGate({ ...ctx, config: { ...ctx.config, domains: { [DOMAIN]: row.spec ?? SPEC } } }, DOMAIN, row.stage ?? 'baseline', row.applied ?? true, {
          check: async () => row.report ?? refused(),
          findZone: async () => ({ id: 'zone', name: DOMAIN, status: row.status ?? 'pending', name_servers: row.servers ?? [NS] }),
          sleep: async () => { sleeps++; },
        })).rejects.toThrow('gate blocked');
        expect(sleeps).toBe(0);
      }
    } finally { clean(); }
  });
});
