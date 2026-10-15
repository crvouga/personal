import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { errorMessage, type HealthContext } from '../health/context.js';
import { absentDs } from './checks.js';
import { findZone } from './cloudflare.js';
import { delegation, sameSet } from './dns.js';
import { executeOwnerOperation } from './owner-execution.js';
import { check, migrationExitCode, requiredFindings } from './runner.js';
import { gateProgress, type Progress } from './workflow-progress.js';
import { ownerReceipt } from '../../tofu/owner/operation.js';

export const ownerBrowserConfigured = (ctx: HealthContext): boolean => existsSync(join(ctx.repoRoot, '.domain-migration/owner-chrome/Default'));

/** Advance supported source-owner stages; real public DNS still owns every timer. */
export async function prepareOwnerDns(ctx: HealthContext, domain: string, actions: string[], signal?: AbortSignal): Promise<Progress | undefined> {
  const spec = ctx.config.domains![domain];
  if (!ownerBrowserConfigured(ctx) || spec.availability !== 'best-effort' || spec.dns_migration !== 'retire-unused') return;
  try { await absentDs(ctx, domain); }
  catch (error) {
    // A failed lookup is never treated as proof that a DS exists or is absent.
    if (!/parent DS still published\/cached/.test(errorMessage(error))) return;
    const operation = { action: 'disable-dnssec' as const, domain, nameservers: [] };
    const already = ownerReceipt(ctx.repoRoot, operation);
    await executeOwnerOperation(ctx, operation, signal);
    if (!already) actions.push(`${domain}: Squarespace DNSSEC disable verified through a scoped saved OpenTofu plan`);
    return { domain, state: 'waiting', detail: 'Source DNSSEC disable accepted; waiting for authoritative parent DS removal and old caches; nameservers remain unchanged' };
  }
  const expected = (await findZone(ctx, domain)).name_servers;
  if (sameSet((await delegation(ctx, domain)).servers, expected)) return;
  const report = await check(ctx, domain, 'cutover');
  if (migrationExitCode(report, spec)) return gateProgress(domain, requiredFindings(report, ctx, domain));
  const operation = { action: 'delegate' as const, domain, nameservers: expected };
  const already = ownerReceipt(ctx.repoRoot, operation);
  await executeOwnerOperation(ctx, operation, signal);
  if (!already) actions.push(`${domain}: exact Cloudflare nameservers submitted through a scoped saved OpenTofu plan`);
  return { domain, state: 'waiting', detail: 'Nameserver change accepted; waiting for public convergence and the verified delegation soak' };
}
