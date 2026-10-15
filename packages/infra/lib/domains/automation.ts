import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { errorMessage, type HealthContext } from '../health/context.js';
import type { HealthReport } from '../health/report.js';
import { registrar } from './checks.js';
import { findZone, registration, transferStatus } from './cloudflare.js';
import { draft } from './draft.js';
import { candidateFlag, execute, inventoryPath } from './execution.js';
import { baseline, directory, privateJson, readJson } from './files.js';
import { loadServicesConfig } from '../services.js';
import { existingState } from './prerequisites.js';
import { check, migrationExitCode, requireGate, requiredFindings as failures } from './runner.js';
import { migrationProgress } from './progress.js';
import { gateProgress, workflowProgress, type Progress } from './workflow-progress.js';
import { prepareOwnerDns } from './owner-workflow.js';

export { gateProgress, workflowProgress, type Progress } from './workflow-progress.js';

export type AutomationReport = { readonly actions: readonly string[]; readonly progress: readonly Progress[] };

const DOMAIN_PORTS = { draft, execute, check, requireGate, registration, registrar, transferStatus };
export async function domainStep(initial: HealthContext, domain: string, actions: string[], ports = DOMAIN_PORTS, signal?: AbortSignal): Promise<Progress> {
  let ctx = initial;
  const dir = directory(ctx.repoRoot, domain);
  if (!existsSync(join(dir, 'baseline.json'))) return { domain, state: 'blocked', detail: 'Complete baseline or explicit unused-source retirement observation is missing' };
  // Resolve any interrupted operation before considering another saved plan.
  for (const purpose of ['source', 'transfer', 'secure']) {
    if (existsSync(join(dir, `${purpose}-attempt.json`)) && !existsSync(join(dir, `${purpose}-attempt.json.applied`)) && !existsSync(join(dir, `${purpose}-attempt.json.succeeded`))) {
      // Transfer uncertainty can be resolved safely by status reads below.
      if (purpose !== 'transfer') return { domain, state: 'blocked', detail: `${purpose} apply has an unresolved outcome; preserve state and reconcile its saved plan` };
    }
  }
  if (!existsSync(join(dir, 'source-adopted.json'))) {
    if (existsSync(join(dir, 'source-attempt.json.succeeded')) || existsSync(join(dir, 'source-attempt.json.applied'))) await ports.requireGate(ctx, domain, 'baseline', true);
    else {
      const path = await ports.draft(ctx, domain, ctx.config.domains![domain], baseline(ctx.repoRoot, domain));
      ctx = await ports.execute(ctx, domain, 'source', readJson(path), undefined, signal);
    }
    // Receipt is written only after the full apply and baseline post-check pass.
    privateJson(join(dir, 'source-adopted.json'), { verifiedAt: ctx.now().toISOString() });
    actions.push(`${domain}: source inventory adopted through a scoped saved OpenTofu plan`);
  }
  if (signal?.aborted) return { domain, state: 'blocked', detail: 'Stopped after current safe operation; rerun to resume' };
  let active = false;
  try { active = (await ports.registration(ctx, domain)).status === 'active'; }
  catch (err) { if (!errorMessage(err).includes(': HTTP 404;')) throw err; }
  // Once registration settings are adopted, final checks use the final DNSSEC
  // policy. A restart must not demand disabling an already-secured signer.
  if (active && ctx.config.domains![domain].manage_registration) {
    const complete = await ports.check(ctx, domain, 'complete');
    return migrationExitCode(complete, ctx.config.domains![domain]) ? gateProgress(domain, failures(complete, ctx, domain))
      : { domain, state: 'complete', detail: 'Registration, security, exact DNS, cache waits and required services verified' };
  }
  if (!active) {
    const owner = await prepareOwnerDns(ctx, domain, actions, signal);
    if (owner) return owner;
  }
  const live = await ports.check(ctx, domain, 'dns-live');
  if (migrationExitCode(live, ctx.config.domains![domain])) return gateProgress(domain, failures(live, ctx, domain));
  if (active) {
    try { await ports.registrar(ctx, domain, true, false); }
    catch (err) { return { domain, state: /RDAP registrar is not Cloudflare|RDAP HTTP 429|RDAP HTTP 5\d\d/.test(errorMessage(err)) ? 'waiting' : 'blocked', detail: `Active Cloudflare registration; RDAP confirmation: ${errorMessage(err)}` }; }
    if (!ctx.config.domains![domain].manage_registration) {
      ctx = await ports.execute(ctx, domain, 'secure', candidateFlag(ctx, domain, 'manage_registration'), undefined, signal);
      actions.push(`${domain}: registration lock, renewal and privacy adopted through OpenTofu`);
    }
    const complete = await ports.check(ctx, domain, 'complete');
    return migrationExitCode(complete, ctx.config.domains![domain])
      ? gateProgress(domain, failures(complete, ctx, domain))
      : { domain, state: 'complete', detail: 'Registration, security, exact DNS, cache waits and required services verified' };
  }
  try { return workflowProgress(domain, (await ports.transferStatus(ctx, domain)).state); }
  catch (err) { if (!errorMessage(err).includes(': HTTP 404;')) throw err; }
  if (existsSync(join(dir, 'transfer-attempt.json'))) return { domain, state: 'blocked', detail: 'Prior transfer attempt has no visible workflow; uncertain POST will not be retried' };
  // The gate checks unlock, authorized EPP, extension support,
  // complete DNS/HTTPS and duplicate absence before the billable saved plan.
  const candidate = candidateFlag(ctx, domain, 'transfer_enabled');
  const enabled = { ...ctx, config: { ...ctx.config, domains: { ...ctx.config.domains, [domain]: { ...ctx.config.domains![domain], transfer_enabled: true } } } };
  const ready = await ports.check(enabled, domain, 'transfer');
  if (migrationExitCode(ready, enabled.config.domains![domain])) return gateProgress(domain, failures(ready, enabled, domain));
  await ports.execute(ctx, domain, 'transfer', candidate, undefined, signal);
  actions.push(`${domain}: one registrar transfer submitted through OpenTofu`);
  return workflowProgress(domain, (await ports.transferStatus(ctx, domain)).state);
}

const AUTOMATION_PORTS = { existingState, domainStep, reload: (ctx: HealthContext) => loadServicesConfig(inventoryPath(ctx)) };

/** Serial writes share one foundation state; shared drift blocks every domain. */
export async function automate(ctx: HealthContext, signal?: AbortSignal, ports = AUTOMATION_PORTS): Promise<AutomationReport> {
  const actions: string[] = [];
  const progress: Progress[] = [];
  try { ctx = { ...ctx, env: await ports.existingState(ctx) }; }
  catch (err) { return { actions, progress: [{ domain: '*', state: 'blocked', detail: `OPENTOFU_STATE_REQUIRED: ${errorMessage(err)}` }] }; }
  for (const domain of Object.keys(ctx.config.domains ?? {})) {
    if (signal?.aborted) break;
    migrationProgress('domain-execution', 'Checking available migration stages', domain);
    try {
      // A preceding domain may have installed its reviewed canonical candidate.
      progress.push(await ports.domainStep({ ...ctx, config: ports.reload(ctx) }, domain, actions, DOMAIN_PORTS, signal));
    } catch (err) {
      progress.push({ domain, state: 'blocked', detail: errorMessage(err) });
      migrationProgress('stage-blocked', 'Stage blocked; preserving evidence and checking remaining actions', domain);
      if (/^Unrelated (?:change|forwarding change) blocked:/.test(errorMessage(err))) {
        migrationProgress('foundation-drift', 'Unrelated foundation changes block migration plans; stopping further domain writes');
        progress.push({ domain: '*', state: 'blocked', detail: `FOUNDATION_DRIFT_REQUIRED: ${errorMessage(err)}. Shared foundation drift needs its own reviewed OpenTofu plan; no further domain writes attempted` });
        break;
      }
      // A partial apply leaves desired configuration intact. Stop further writes
      // to the shared state; remaining domains still get campaign health checks.
      const dir = directory(ctx.repoRoot, domain);
      if (['source', 'transfer', 'secure'].some((purpose) => existsSync(join(dir, `${purpose}-attempt.json`)) && !existsSync(join(dir, `${purpose}-attempt.json.succeeded`)))) break;
    }
  }
  return { actions, progress };
}

export async function nameserverAction(ctx: HealthContext, domain: string): Promise<string> {
  try { return `Use only these account-assigned nameservers if delegation must change: ${(await findZone(ctx, domain)).name_servers.join(', ')}`; }
  catch { return 'Cloudflare zone must first be adopted through OpenTofu; assigned nameservers are not yet available'; }
}
