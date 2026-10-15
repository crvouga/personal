import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { asRecord, asStrings, errorMessage, type HealthContext } from '../health/context.js';
import { absentDs, waited } from './checks.js';
import { baseline, digest, directory, evidence, privateJson, readJson } from './files.js';
import { parseRecords, settingsKey } from './records.js';
import { requireGate } from './runner.js';
import { effectiveRecords } from './forwarding.js';
import { acceptedTransfer } from './transfers.js';
import { migrationProgress } from './progress.js';

const fileHash = (path: string): string => createHash('sha256').update(readFileSync(path)).digest('hex');
const rootArg = (ctx: HealthContext): string => `-chdir=${join(ctx.repoRoot, 'packages/infra/tofu/foundation')}`;

async function criticalHealth(ctx: HealthContext): Promise<void> {
  const blocked: string[] = [];
  for (const [domain, spec] of Object.entries(ctx.config.domains ?? {})) {
    if (spec.availability !== 'critical') continue;
    try { await requireGate(ctx, domain, 'baseline'); }
    catch (err) { blocked.push(`${domain}: ${errorMessage(err)}`); }
  }
  if (blocked.length) throw new Error(`Critical domain health blocked: ${blocked.join('; ')}`);
}

export function validatePlan(value: unknown, domain: string, purpose: string, expected: readonly string[], primary = false): string[] {
  const plan = asRecord(value);
  if (plan.errored === true) throw new Error('OpenTofu plan is not applyable');
  if (!Array.isArray(plan.resource_changes)) throw new Error('Plan resource_changes missing');
  const summary: string[] = [];
  for (const item of plan.resource_changes) {
    const resource = asRecord(item);
    const change = asRecord(resource.change);
    const actions = asStrings(change.actions);
    if (actions.length === 0) throw new Error('Plan change has no valid actions');
    const address = String(resource.address);
    const importing = change.importing !== undefined && change.importing !== null;
    if (!importing && actions.length === 1 && (actions[0] === 'no-op' || actions[0] === 'read')) continue;
    if (plan.applyable === false) throw new Error('OpenTofu plan is not applyable');
    if (actions.some((action) => !['create', 'update', ...(importing ? ['no-op'] : [])].includes(action))) throw new Error(`Refusing deletion/replacement/unknown action: ${address}`);
    const zone = `cloudflare_zone.domain[${JSON.stringify(domain)}]`;
    const dnssec = `cloudflare_zone_dnssec.domain[${JSON.stringify(domain)}]`;
    const registration = `cloudflare_registrar_domain.domain[${JSON.stringify(domain)}]`;
    const isRecord = address.startsWith(`cloudflare_dns_record.domain["${domain}:`);
    const after = asRecord(change.after);
    if (purpose === 'source') {
      if (address === zone && (after.name !== domain || after.type !== 'full')) throw new Error('Staged zone identity/type differs from the selected domain');
      if (address === zone && actions.includes('update')) throw new Error('Zone updates are outside staging scope');
      if (address !== zone && address !== dnssec && !isRecord) throw new Error(`Unrelated change blocked: ${address}`);
      if (address === dnssec && after.status !== 'disabled') throw new Error('Do not enable DNSSEC during staging');
      if (isRecord) {
        const record = parseRecords([after], domain)[0];
        if (!expected.includes(settingsKey(record))) throw new Error(`${address}: proposed record differs from baseline`);
      }
    } else if (purpose === 'forwarding') {
      const ruleset = `cloudflare_ruleset.domain_forwarding[${JSON.stringify(domain)}]`;
      if (address !== ruleset && !isRecord) throw new Error(`Unrelated forwarding change blocked: ${address}`);
      if (isRecord && !expected.includes(settingsKey(parseRecords([after], domain)[0]))) throw new Error('Forwarding record differs from explicit transformation');
    } else if (purpose === 'transfer') {
      if (address !== `restapi_object.domain_transfer[${JSON.stringify(domain)}]` || (actions.join(',') !== 'create' && !importing)) throw new Error('A transfer plan may only create/adopt the selected one-time workflow');
      if (after.object_id !== domain || after.path !== `/${domain}/transfer-in` || after.create_method !== 'POST' ||
        (after.create_path != null && after.create_path !== `/${domain}/transfer-in`) || (after.query_string != null && after.query_string !== '') ||
        after.read_path !== `/${domain}` || after.read_method !== 'GET' || after.update_method !== 'GET' || after.update_path !== `/${domain}` || after.destroy_method !== 'GET' || after.destroy_path !== `/${domain}` || after.debug !== false || after.ignore_all_server_changes !== true) throw new Error('Transfer resource paths/methods differ from the guarded API contract');
      let body: Record<string, unknown>;
      try { body = asRecord(JSON.parse(String(after.data))); } catch { throw new Error('Transfer data is not valid JSON; sensitive input withheld'); }
      if (Object.keys(body).some((key) => !['auth_code', 'auto_renew', 'privacy_mode'].includes(key))) throw new Error('Unexpected transfer payload fields');
      const code = String(body.auth_code ?? '');
      if (!/^[A-Za-z0-9+/]+={0,2}$/.test(code) || !Buffer.from(code, 'base64').length || Buffer.from(code, 'base64').toString('base64') !== code || body.auto_renew !== true || body.privacy_mode !== 'redaction') throw new Error('Transfer payload must contain a valid encoded owner code, auto-renew and privacy');
    } else if (purpose === 'secure') {
      if (address !== dnssec && address !== registration && !(primary && address === 'cloudflare_zone_dnssec.primary')) throw new Error(`Unrelated change blocked: ${address}`);
      if (address === registration && (after.auto_renew !== true || after.locked !== true || after.privacy !== true)) throw new Error('Registration security settings must be enabled');
    } else throw new Error('Plan purpose must be source, forwarding, transfer or secure');
    summary.push(`${actions.join('/')} ${address}`);
  }
  return summary;
}

async function inspect(ctx: HealthContext, path: string, domain: string, purpose: string): Promise<string[]> {
  const show = await ctx.run('tofu', [rootArg(ctx), 'show', '-json', path], { timeoutMs: 60000, env: ctx.env });
  if (show.code !== 0) throw new Error('Cannot inspect encrypted plan; check OpenTofu/state passphrase. Output withheld because it may contain secrets');
  let parsed: Readonly<Record<string, unknown>>;
  try { parsed = asRecord(JSON.parse(show.stdout)); }
  catch { throw new Error('Cannot parse saved plan JSON; sensitive output withheld'); }
  const changes = Array.isArray(parsed.resource_changes) ? parsed.resource_changes.map(asRecord) : [];
  const disablingSigner = changes.some((resource) => resource.type === 'cloudflare_zone_dnssec' &&
    asRecord(asRecord(resource.change).before).status === 'active' && asRecord(asRecord(resource.change).after).status === 'disabled');
  if (disablingSigner) {
    await absentDs(ctx, domain);
    const snapshot = baseline(ctx.repoRoot, domain);
    waited(ctx.now(), evidence(ctx.repoRoot, domain).dsAbsentSince, Math.max(snapshot.maxObservedTtl, ctx.config.domains![domain].settle_seconds), 'dsAbsentSince before disabling signer');
  }
  const spec = ctx.config.domains![domain];
  for (const resource of changes) {
    const after = asRecord(asRecord(resource.change).after);
    if (resource.type === 'cloudflare_zone' && after.account && asRecord(after.account).id !== (ctx.env['TF_VAR_cloudflare_account_id'] ?? ctx.env['CLOUDFLARE_ACCOUNT_ID'])) throw new Error('Staged zone belongs to a different account');
    if (purpose === 'secure' && (resource.address === `cloudflare_zone_dnssec.domain[${JSON.stringify(domain)}]` || (domain === ctx.config.zone && resource.address === 'cloudflare_zone_dnssec.primary')) && after.status !== spec.dnssec_status) throw new Error('DNSSEC plan differs from the selected security policy');
  }
  if (purpose === 'source' && spec.forwarding_enabled) throw new Error('Stage DNS-only first; use a separate forwarding plan after delegation and certificate checks');
  return validatePlan(parsed, domain, purpose, effectiveRecords(baseline(ctx.repoRoot, domain).records, spec).map(settingsKey), domain === ctx.config.zone);
}

function planPath(ctx: HealthContext, domain: string, name: string): string {
  if (!/^[a-z0-9-]+\.tfplan$/.test(name)) throw new Error('Use a simple lowercase name ending in .tfplan');
  return resolve(directory(ctx.repoRoot, domain), name);
}

export async function plan(ctx: HealthContext, domain: string, purpose: 'source' | 'forwarding' | 'transfer' | 'secure', name: string) {
  migrationProgress('plan-checks', `Checking critical website continuity before the ${purpose} plan`, domain);
  await criticalHealth(ctx);
  await requireGate(ctx, domain, purpose);
  const path = planPath(ctx, domain, name);
  if (existsSync(path) || existsSync(`${path}.json`)) throw new Error('Plan exists; choose a new name');
  migrationProgress('opentofu-plan', `Planning ${purpose} changes across foundation serially; this can take several minutes (timeout: 10 minutes)`, domain);
  const result = await ctx.run('tofu', [rootArg(ctx), 'plan', '-input=false', '-parallelism=1', `-out=${path}`], { timeoutMs: 600000, env: ctx.env });
  if (result.code !== 0) throw new Error('OpenTofu plan failed. Run bun run infra plan to diagnose securely; provider output withheld');
  migrationProgress('plan-review', 'Reviewing the encrypted saved plan against the domain scope policy', domain);
  const summary = await inspect(ctx, path, domain, purpose);
  const sha256 = fileHash(path);
  privateJson(`${path}.json`, {
    domain, purpose, sha256, createdAt: ctx.now().toISOString(), summary,
    inventoryHash: digest(ctx.config), baselineHash: digest(baseline(ctx.repoRoot, domain)),
    operatorHash: digest(evidence(ctx.repoRoot, domain)),
  });
  return { path, sha256, summary };
}

export async function apply(ctx: HealthContext, domain: string, name: string, reviewedHash: string, beforeApply?: () => void, afterApply?: () => void) {
  migrationProgress('apply-checks', 'Verifying saved plan identity and critical website continuity before apply', domain);
  const path = planPath(ctx, domain, name);
  const metadata = asRecord(readJson(`${path}.json`));
  if (metadata.domain !== domain || !['source', 'forwarding', 'transfer', 'secure'].includes(String(metadata.purpose))) throw new Error('Plan metadata mismatch');
  if (!/^[a-f0-9]{64}$/.test(reviewedHash) || metadata.sha256 !== reviewedHash || fileHash(path) !== reviewedHash) throw new Error('Reviewed encrypted plan SHA-256 mismatch');
  if (metadata.inventoryHash !== digest(ctx.config) || metadata.baselineHash !== digest(baseline(ctx.repoRoot, domain)) || metadata.operatorHash !== digest(evidence(ctx.repoRoot, domain))) throw new Error('Inventory/evidence changed; create and review a fresh plan');
  const age = ctx.now().getTime() - Date.parse(String(metadata.createdAt));
  if (!Number.isFinite(age) || age < 0 || age > 3600000) throw new Error('Plan older than one hour; replan and review');
  await requireGate(ctx, domain, metadata.purpose as 'source' | 'forwarding' | 'transfer' | 'secure');
  await criticalHealth(ctx);
  await inspect(ctx, path, domain, String(metadata.purpose));
  beforeApply?.();
  let code = 1;
  let executionError = false;
  try {
    migrationProgress('opentofu-apply', 'Applying the reviewed saved plan serially (timeout: 10 minutes)', domain);
    code = (await ctx.run('tofu', [rootArg(ctx), 'apply', '-input=false', '-parallelism=1', path], { timeoutMs: 600000, env: ctx.env })).code;
    if (code === 0) afterApply?.();
  } catch { executionError = true; }
  // Even a partial failed apply is followed by health probes; never auto-retry a mutation.
  migrationProgress('post-apply', 'Verifying critical websites, DNS and the completed stage after apply', domain);
  const health = await Promise.allSettled([
    criticalHealth(ctx),
    requireGate(ctx, domain, metadata.purpose === 'source' ? 'baseline' : ['forwarding', 'transfer'].includes(String(metadata.purpose)) ? 'dns-live' : 'complete'),
    ...(metadata.purpose === 'transfer' ? [acceptedTransfer(ctx, domain)] : []),
  ]);
  if (executionError || code !== 0) throw new Error('Apply failed, was interrupted or its receipt could not be persisted; post-checks attempted. Preserve state, inspect a fresh plan; never blindly retry');
  const rejected = health.filter((result) => result.status === 'rejected');
  if (rejected.length) throw new Error(rejected.map((result) => errorMessage(result.reason)).join('; '));
}
