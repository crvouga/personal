import { describe, expect, test } from 'bun:test';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { hostname, tmpdir } from 'node:os';
import { join } from 'node:path';
import { fakeContext } from '../health/fixtures.test-support.js';
import { fail, pass, skip, type HealthReport } from '../health/report.js';
import { domainStep, gateProgress, workflowProgress } from './automation.js';
import { migrationChecks } from './checks.js';
import { candidateFlag, execute, inventoryPath, reviewCandidate } from './execution.js';
import { baseline, directory, evidence, initialize, privateJson, readJson } from './files.js';
import { ownerCodes } from './inputs.js';
import { campaignLock } from './lock.js';
import { migrate, type MigrationPorts } from './migration.js';
import type { DomainSpec, Snapshot } from './model.js';
import { existingState } from './prerequisites.js';
import { plan } from './plans.js';
import { migrationExitCode } from './runner.js';

const DOMAIN = 'example.dev';
const SPEC: DomainSpec = { availability: 'best-effort', dns_migration: 'retire-unused', manage_zone: false, records: {}, dnssec_status: 'disabled', manage_registration: false,
  settle_seconds: 172800, web_usage: 'none', forwarding_enabled: false, forwarding: [], https: [], transfer_enabled: false };
const SNAPSHOT: Snapshot = { version: 1, domain: DOMAIN, capturedAt: '2026-10-01T00:00:00Z', source: 'retired-unused', sourceNameservers: ['ns1.source.dev', 'ns2.source.dev'], records: [], maxObservedTtl: 172800 };
function fixture() {
  const repoRoot = mkdtempSync(join(tmpdir(), 'migration-automation-'));
  const ctx = fakeContext({ repoRoot, config: { ...fakeContext().config, domains: { [DOMAIN]: SPEC } } });
  initialize(repoRoot, DOMAIN);
  privateJson(join(directory(repoRoot, DOMAIN), 'baseline.json'), SNAPSHOT);
  const path = inventoryPath(ctx);
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, JSON.stringify({ locals: { inventory: ctx.config } }));
  return { ctx, clean: () => rmSync(repoRoot, { recursive: true, force: true }) };
}
const health = (...results: ReturnType<typeof pass>[]): HealthReport => ({ zone: DOMAIN, startedAt: '', durationMs: 0, groups: [{ id: 'domains', title: '', durationMs: 0, results }] });

describe('unattended domain migration', () => {
  test('owner codes load as one private batch, reject symlinks/public permissions, and never leak malformed contents', () => {
    const { ctx, clean } = fixture();
    try {
      const path = join(ctx.repoRoot, '.domain-migration/auth-codes.json');
      expect(ownerCodes(ctx.repoRoot, {})).toBeUndefined();
      privateJson(path, { [DOMAIN]: 'private-owner-code' });
      expect(JSON.parse(ownerCodes(ctx.repoRoot, {})!)[DOMAIN]).toBe('private-owner-code');
      chmodSync(path, 0o644);
      expect(() => ownerCodes(ctx.repoRoot, {})).toThrow('owner-only');
      chmodSync(path, 0o600);
      writeFileSync(path, 'sensitive-malformed-secret');
      expect(() => ownerCodes(ctx.repoRoot, {})).toThrow('contents withheld');
      rmSync(path);
      symlinkSync(inventoryPath(ctx), path);
      expect(() => ownerCodes(ctx.repoRoot, {})).toThrow('owner-only');
      expect(ownerCodes(ctx.repoRoot, { TF_VAR_domain_auth_codes: '{}' })).toBe('{}');
    } finally { clean(); }
  });

  test('automated candidate review preserves policy, primary ownership and unrelated inventory', () => {
    const { ctx, clean } = fixture();
    try {
      const valid = candidateFlag(ctx, DOMAIN, 'transfer_enabled');
      expect(reviewCandidate(ctx, DOMAIN, valid, 'transfer').transfer_enabled).toBe(true);
      for (const change of [
        (value: any) => { value.locals.inventory.zone = 'other.dev'; },
        (value: any) => { value.locals.inventory.domains[DOMAIN].availability = 'critical'; },
        (value: any) => { value.locals.inventory.domains['extra.dev'] = SPEC; },
        (value: any) => { value.locals.inventory.domains[DOMAIN].manage_registration = true; },
      ]) {
        const altered = structuredClone(valid); change(altered);
        expect(() => reviewCandidate(ctx, DOMAIN, altered, 'transfer')).toThrow();
      }
      const wrongDns: any = readJson(inventoryPath(ctx));
      wrongDns.locals.inventory.domains[DOMAIN].records = { hidden: { name: DOMAIN, type: 'A', ttl: 1, proxied: true, content: '192.0.2.1' } };
      expect(() => reviewCandidate(ctx, DOMAIN, wrongDns, 'source')).toThrow('differs');
    } finally { clean(); }
  });

  test('a rejected plan restores only its own local inventory and never creates a mutation intent', async () => {
    const { ctx, clean } = fixture();
    try {
      const original = readFileSync(inventoryPath(ctx), 'utf8');
      let applies = 0;
      await expect(execute(ctx, DOMAIN, 'transfer', candidateFlag(ctx, DOMAIN, 'transfer_enabled'), {
        plan: async () => { throw new Error('unrelated infrastructure change blocked'); },
        apply: async () => { applies++; },
      })).rejects.toThrow('unrelated');
      expect(applies).toBe(0);
      expect(readFileSync(inventoryPath(ctx), 'utf8')).toBe(original);
      expect(existsSync(join(directory(ctx.repoRoot, DOMAIN), 'transfer-attempt.json'))).toBe(false);
    } finally { clean(); }
  });

  test('uncertain apply retains desired state and durable intent; the command cannot replay it', async () => {
    const { ctx, clean } = fixture();
    try {
      let writes = 0;
      const ports = {
        plan: async () => ({ path: join(directory(ctx.repoRoot, DOMAIN), 'fixture.tfplan'), sha256: 'a'.repeat(64), summary: ['create selected workflow'] }),
        apply: async (_ctx: unknown, _domain: string, _name: string, _hash: string, before?: () => void) => { before?.(); writes++; throw new Error('connection lost after POST'); },
      };
      const candidate = candidateFlag(ctx, DOMAIN, 'transfer_enabled');
      await expect(execute(ctx, DOMAIN, 'transfer', candidate, ports)).rejects.toThrow('connection lost');
      expect(JSON.parse(readFileSync(inventoryPath(ctx), 'utf8')).locals.inventory.domains[DOMAIN].transfer_enabled).toBe(true);
      expect(existsSync(join(directory(ctx.repoRoot, DOMAIN), 'transfer-attempt.json'))).toBe(true);
      await expect(execute(ctx, DOMAIN, 'transfer', candidate, ports)).rejects.toThrow('already attempted');
      expect(writes).toBe(1);
    } finally { clean(); }
  });

  test('an interrupt during plan review restores inventory and cannot start an apply', async () => {
    const { ctx, clean } = fixture();
    try {
      const stop = new AbortController();
      const original = readFileSync(inventoryPath(ctx), 'utf8');
      let applies = 0;
      await expect(execute(ctx, DOMAIN, 'transfer', candidateFlag(ctx, DOMAIN, 'transfer_enabled'), {
        plan: async () => { stop.abort(); return { path: join(directory(ctx.repoRoot, DOMAIN), 'fixture.tfplan'), sha256: 'a'.repeat(64), summary: ['create workflow'] }; },
        apply: async () => { applies++; },
      }, stop.signal)).rejects.toThrow();
      expect(applies).toBe(0);
      expect(readFileSync(inventoryPath(ctx), 'utf8')).toBe(original);
    } finally { clean(); }
  });

  test('successful apply followed by unhealthy probes is distinguishable from an uncertain apply', async () => {
    const { ctx, clean } = fixture();
    try {
      await expect(execute(ctx, DOMAIN, 'secure', candidateFlag(ctx, DOMAIN, 'manage_registration'), {
        plan: async () => ({ path: join(directory(ctx.repoRoot, DOMAIN), 'fixture.tfplan'), sha256: 'b'.repeat(64), summary: ['secure selected registration'] }),
        apply: async (_ctx, _domain, _name, _hash, before, after) => { before?.(); after?.(); throw new Error('DNSSEC propagation has not completed'); },
      })).rejects.toThrow('propagation');
      const attempt = join(directory(ctx.repoRoot, DOMAIN), 'secure-attempt.json');
      expect(existsSync(`${attempt}.applied`)).toBe(true);
      expect(existsSync(`${attempt}.succeeded`)).toBe(false);
    } finally { clean(); }
  });

  test('only real elapsed-time gates and pending workflows poll; missing evidence and invalid timestamps stop', () => {
    expect(gateProgress(DOMAIN, ['Delegation soak: delegationChangedAt: wait until 2026-10-13T00:00:00.000Z (172800 seconds)']).state).toBe('waiting');
    expect(gateProgress(DOMAIN, ['Delegation soak: delegationChangedAt: missing, invalid or future observation timestamp']).state).toBe('blocked');
    expect(gateProgress(DOMAIN, ['DNSSEC removal and cache wait: 1.1.1.1: parent DS still published']).state).toBe('blocked');
    expect(gateProgress(DOMAIN, ['billingReview: missing']).state).toBe('blocked');
    for (const state of ['pending', 'in_progress', 'succeeded']) expect(workflowProgress(DOMAIN, state).state).toBe('waiting');
    for (const state of ['blocked', 'action_required', 'failed', 'unknown']) expect(workflowProgress(DOMAIN, state).state).toBe('blocked');
  });

  test('missing original backend never triggers initialization or replacement-state adoption', async () => {
    let calls = 0;
    await expect(existingState(fakeContext({ fileExists: () => false, run: async (command) => { calls++; expect(command).toBe('git'); return { code: 1, stdout: '', stderr: '' }; } }))).rejects.toThrow('refusing to guess');
    expect(calls).toBe(2);
    await expect(existingState(fakeContext({ fileExists: () => true, run: async () => ({ code: 0, stdout: '{"values":{}}', stderr: '' }) }))).rejects.toThrow('empty');
  });

  test('worktree automatically reuses the original locked backend for the same account, without copying credentials', async () => {
    const { ctx, clean } = fixture();
    const source = mkdtempSync(join(tmpdir(), 'original-infra-'));
    try {
      const account = 'a'.repeat(32);
      for (const root of ['foundation', 'fleet']) {
        const dir = join(source, 'packages/infra/tofu', root);
        mkdirSync(dir, { recursive: true });
        privateJson(join(dir, 'backend.backend.json'), { bucket: 'existing-state', key: `${root}.tfstate`, use_lockfile: true, endpoints: { s3: `https://${account}.r2.cloudflarestorage.com` } });
      }
      let initialized = 0;
      await existingState({ ...ctx, env: { CLOUDFLARE_ACCOUNT_ID: account, TF_VAR_state_passphrase: 'test-existing-passphrase-32-chars-minimum' }, fileExists: existsSync, readFile: (path) => readFileSync(path, 'utf8'),
        run: async (command, args) => {
          if (command === 'git') return { code: 0, stdout: join(source, '.git'), stderr: '' };
          if (args.includes('init')) { initialized++; expect(args).toContain('-lockfile=readonly'); expect(args).not.toContain('-migrate-state'); }
          return { code: 0, stdout: '{"values":{"root_module":{"resources":[{}]}}}', stderr: '' };
        },
      });
      expect(initialized).toBe(2);
      expect(JSON.parse(readFileSync(join(ctx.repoRoot, 'packages/infra/tofu/foundation/backend.backend.json'), 'utf8')).key).toBe('foundation.tfstate');
    } finally { clean(); rmSync(source, { recursive: true, force: true }); }
  });

  test('staging an explicitly retired unused zone needs no invented owner attestations', async () => {
    const { ctx, clean } = fixture();
    try {
      const report = await migrationChecks(ctx, DOMAIN, SPEC, baseline(ctx.repoRoot, DOMAIN), evidence(ctx.repoRoot, DOMAIN), 'source');
      expect(report.some((row) => row.status === 'fail')).toBe(false);
      expect(report.some((row) => row.name.includes('Operator'))).toBe(false);
    } finally { clean(); }
  });

  test('account findings are entered once, never invented, and per-domain findings take precedence', () => {
    const { ctx, clean } = fixture();
    try {
      expect(evidence(ctx.repoRoot, DOMAIN).billingReview).toBe('');
      const common = join(ctx.repoRoot, '.domain-migration/account-operator.json');
      writeFileSync(common, JSON.stringify({ accountRecoveryReview: '2026-10-11 verified independent recovery', billingReview: '2026-10-11 verified account payment', retirementReview: '' }));
      expect(evidence(ctx.repoRoot, DOMAIN).billingReview).toBe('2026-10-11 verified account payment');
      expect(evidence(ctx.repoRoot, DOMAIN).transferEligibilityReview).toBe('');
      const local = join(directory(ctx.repoRoot, DOMAIN), 'operator.json');
      const value = readJson(local) as Record<string, string>;
      writeFileSync(local, JSON.stringify({ ...value, billingReview: '2026-10-12 domain-specific fee findings' }));
      expect(evidence(ctx.repoRoot, DOMAIN).billingReview).toBe('2026-10-12 domain-specific fee findings');
    } finally { clean(); }
  });

  test('optional owner notes remain unverified without blocking automation; actual missing access still blocks', () => {
    const report = { ...health(pass('DNS preservation', 'verified')), groups: [
      ...health(pass('DNS preservation', 'verified')).groups,
      { id: 'owner-review', title: 'Optional findings', durationMs: 0, results: [skip('Owner review: billingReview', 'Not independently inspected')] },
    ] };
    expect(migrationExitCode(report, SPEC)).toBe(0);
    const missingAccess = { ...report, groups: [{ ...report.groups[0], results: [skip('Transfer API', 'credential missing')] }, report.groups[1]] };
    expect(migrationExitCode(missingAccess, SPEC)).toBe(1);
  });

  test('concurrent campaigns cannot edit inventory; release permits a clean resume', () => {
    const { ctx, clean } = fixture();
    try {
      const release = campaignLock(ctx.repoRoot);
      expect(() => campaignLock(ctx.repoRoot)).toThrow('already running');
      release();
      campaignLock(ctx.repoRoot)();
      expect(existsSync(join(ctx.repoRoot, '.domain-migration/execution.lock'))).toBe(false);
      const path = join(ctx.repoRoot, '.domain-migration/execution.lock');
      privateJson(path, { host: hostname(), pid: 2147483647 });
      campaignLock(ctx.repoRoot)();
      privateJson(path, { host: 'another-host', pid: 2147483647 });
      expect(() => campaignLock(ctx.repoRoot)).toThrow('another host');
    } finally { clean(); }
  });

  test('a missing critical baseline blocks even an unused-domain plan before OpenTofu can run', async () => {
    const { ctx, clean } = fixture();
    let commands = 0;
    try {
      const critical = 'important.dev';
      const guarded = { ...ctx, config: { ...ctx.config, domains: { ...ctx.config.domains, [critical]: {
        ...SPEC, availability: 'critical' as const, dns_migration: 'preserve' as const, web_usage: 'required' as const,
        https: [{ url: `https://${critical}/`, status: 200 }],
      } } }, run: async () => { commands++; throw new Error('must not run'); } };
      await expect(plan(guarded, DOMAIN, 'source', 'test.tfplan')).rejects.toThrow();
      expect(commands).toBe(0);
    } finally { clean(); }
  });

  test('full domain lifecycle submits once, resumes pending, then secures active registration', async () => {
    const { ctx, clean } = fixture();
    try {
      privateJson(join(directory(ctx.repoRoot, DOMAIN), 'source-adopted.json'), {});
      let current = ctx;
      let active = false, submitted = false, secured = false, dnsHealthy = false;
      const stages: string[] = [];
      const ports = {
        draft: async () => { throw new Error('source is already adopted'); },
        execute: async (_ctx: typeof ctx, _domain: string, purpose: 'source' | 'forwarding' | 'transfer' | 'secure', value: unknown) => {
          expect(dnsHealthy).toBe(true);
          stages.push(purpose);
          if (purpose === 'transfer') { expect(submitted).toBe(false); submitted = true; }
          if (purpose === 'secure') { expect(active).toBe(true); secured = true; }
          writeFileSync(inventoryPath(ctx), JSON.stringify(value));
          current = { ...ctx, config: (value as any).locals.inventory };
          return current;
        },
        check: async (_ctx: typeof ctx, _domain: string, stage: string) => health(dnsHealthy ? pass(stage, 'verified') : fail('DNS records', 'mismatch')),
        requireGate: async () => health(pass('baseline', 'verified')),
        registration: async () => { if (!active) throw new Error('registration: HTTP 404; missing'); return { status: 'active' }; },
        registrar: async () => 'RDAP verified',
        transferStatus: async () => { if (!submitted) throw new Error('status: HTTP 404; missing'); return { state: 'pending' }; },
      };
      const actions: string[] = [];
      expect((await domainStep(current, DOMAIN, actions, ports)).state).toBe('blocked');
      expect(stages).toEqual([]);
      dnsHealthy = true;
      expect((await domainStep(current, DOMAIN, actions, ports)).state).toBe('waiting');
      expect((await domainStep(current, DOMAIN, actions, ports)).state).toBe('waiting');
      expect(stages).toEqual(['transfer']);
      active = true;
      expect((await domainStep(current, DOMAIN, actions, ports)).state).toBe('complete');
      expect(secured).toBe(true);
      expect(stages).toEqual(['transfer', 'secure']);
    } finally { clean(); }
  });

  test('one command polls pending work to completion and audit never calls the executor', async () => {
    const ctx = fakeContext();
    let passes = 0, sleeps = 0;
    const blocked = { status: 'blocked' as const, observedAt: '', domains: 1, blockers: [], snapshots: [] };
    const ports: MigrationPorts = {
      campaign: async () => ({ report: { ...blocked, status: passes >= 2 ? 'complete' : 'blocked' }, path: 'report.json' }),
      automate: async () => { passes++; return { actions: [], progress: [{ domain: DOMAIN, state: passes >= 2 ? 'complete' : 'waiting', detail: 'pending' }] }; },
      handoff: async () => 'next-actions.json', reload: (value) => value, sleep: async () => { sleeps++; },
    };
    expect((await migrate(ctx, { audit: false, once: false, intervalSeconds: 60 }, () => {}, undefined, ports)).report.status).toBe('complete');
    expect(passes).toBe(2); expect(sleeps).toBe(60);
    passes = 0;
    await migrate(ctx, { audit: true, once: false, intervalSeconds: 60 }, () => {}, undefined, ports);
    expect(passes).toBe(0);
  });
});
