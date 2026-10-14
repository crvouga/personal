/** Local transactions and automated review; every remote write is OpenTofu. */
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { asRecord, type HealthContext } from '../health/context.js';
import { baseline, digest, directory, evidence, privateJson, readJson } from './files.js';
import { validateSpec, type DomainSpec } from './model.js';
import { effectiveRecords } from './forwarding.js';
import { settingsKey } from './records.js';
import { apply, plan } from './plans.js';

export const inventoryPath = (ctx: HealthContext): string => join(ctx.repoRoot, 'packages/infra/tofu/modules/inventory/inventory.tf.json');
export type Purpose = 'source' | 'forwarding' | 'transfer' | 'secure';

/** Candidates can adopt observations, never silently change migration policy. */
export function reviewCandidate(ctx: HealthContext, domain: string, candidate: unknown, purpose: Purpose): DomainSpec {
  const current = asRecord(readJson(inventoryPath(ctx)));
  const next = asRecord(candidate);
  const before = asRecord(asRecord(current.locals).inventory);
  const after = asRecord(asRecord(next.locals).inventory);
  const oldDomains = asRecord(before.domains);
  const newDomains = asRecord(after.domains);
  if (digest({ ...current, locals: { ...asRecord(current.locals), inventory: { ...before, domains: null } } }) !==
      digest({ ...next, locals: { ...asRecord(next.locals), inventory: { ...after, domains: null } } }) ||
      digest({ ...oldDomains, [domain]: null }) !== digest({ ...newDomains, [domain]: null })) throw new Error('Candidate changes unrelated inventory');
  const spec = ctx.config.domains![domain];
  if (digest(oldDomains[domain]) !== digest(spec)) throw new Error('Inventory changed concurrently; reload before review');
  const proposed = newDomains[domain] as DomainSpec;
  validateSpec(domain, proposed);
  const allowed = purpose === 'source' ? ['manage_zone', 'existing_zone_id', 'records'] : purpose === 'transfer' ? ['transfer_enabled'] : purpose === 'secure' ? ['manage_registration'] : [];
  const policy = (value: DomainSpec) => Object.fromEntries(Object.entries(value).filter(([key]) => !allowed.includes(key)));
  if (digest(policy(spec)) !== digest(policy(proposed))) throw new Error('Candidate changes migration policy outside the selected stage');
  if (purpose === 'source') {
    if (proposed.manage_zone !== (domain !== ctx.config.zone)) throw new Error('Candidate changes primary zone ownership');
    const snapshot = baseline(ctx.repoRoot, domain);
    if (snapshot.zone && proposed.existing_zone_id !== snapshot.zone.id) throw new Error('Candidate changes the observed zone identity');
    const expected = effectiveRecords(snapshot.records, spec).map(settingsKey);
    if (Object.values(proposed.records).some((record) => !expected.includes(settingsKey(record)))) throw new Error('Candidate DNS differs from the complete baseline');
    for (const [key, record] of Object.entries(spec.records)) {
      if (!proposed.records[key] || settingsKey(proposed.records[key]) !== settingsKey(record) || proposed.records[key].id !== record.id) throw new Error('Candidate removes or rekeys an owned record');
    }
  } else if (purpose === 'transfer' && proposed.transfer_enabled !== true) throw new Error('Transfer candidate must enable its one-time resource');
  else if (purpose === 'secure' && proposed.manage_registration !== true) throw new Error('Secure candidate must adopt registration settings');
  return proposed;
}

export function candidateFlag(ctx: HealthContext, domain: string, field: 'transfer_enabled' | 'manage_registration'): unknown {
  const value = asRecord(readJson(inventoryPath(ctx)));
  const locals = asRecord(value.locals);
  const inventory = asRecord(locals.inventory);
  return { ...value, locals: { ...locals, inventory: { ...inventory, domains: {
    ...asRecord(inventory.domains), [domain]: { ...ctx.config.domains![domain], [field]: true },
  } } } };
}

/** Intent survives SIGKILL/timeouts, so an uncertain billable POST is not replayed. */
export async function execute(ctx: HealthContext, domain: string, purpose: Purpose, candidate: unknown, ports: { plan: typeof plan; apply: typeof apply } = { plan, apply }, signal?: AbortSignal): Promise<HealthContext> {
  signal?.throwIfAborted();
  const attempt = join(directory(ctx.repoRoot, domain), `${purpose}-attempt.json`);
  if (existsSync(attempt)) throw new Error(`${purpose}: an apply was already attempted; reconcile saved state and the existing workflow before another mutation`);
  const proposed = reviewCandidate(ctx, domain, candidate, purpose);
  const path = inventoryPath(ctx);
  const original = readFileSync(path, 'utf8');
  const next = `${JSON.stringify(candidate, null, 2)}\n`;
  const transaction = join(directory(ctx.repoRoot, domain), `transaction-${purpose}-${crypto.randomUUID()}.json`);
  privateJson(transaction, { domain, purpose, before: JSON.parse(original), afterHash: digest(candidate), createdAt: ctx.now().toISOString() });
  const temporary = `${path}.${crypto.randomUUID()}.tmp`;
  writeFileSync(temporary, next, { mode: 0o644, flag: 'wx' });
  // Synchronous comparison immediately before rename also catches other editors.
  if (readFileSync(path, 'utf8') !== original) throw new Error('Inventory changed before installation; candidate not installed');
  renameSync(temporary, path);
  const updated = { ...ctx, config: { ...ctx.config, domains: { ...ctx.config.domains, [domain]: proposed } } };
  let started = false;
  try {
    const name = `auto-${purpose}-${crypto.randomUUID()}.tfplan`;
    const reviewed = await ports.plan(updated, domain, purpose, name);
    signal?.throwIfAborted();
    privateJson(`${reviewed.path}.review.json`, {
      reviewer: 'strict-domain-plan-policy-v1', domain, purpose, sha256: reviewed.sha256,
      summary: reviewed.summary, baselineHash: digest(baseline(ctx.repoRoot, domain)),
      evidenceHash: digest(evidence(ctx.repoRoot, domain)), reviewedAt: ctx.now().toISOString(),
    });
    if (reviewed.summary.length) {
      await ports.apply(updated, domain, name, reviewed.sha256, () => {
        signal?.throwIfAborted();
        privateJson(attempt, { domain, purpose, plan: name, sha256: reviewed.sha256, startedAt: ctx.now().toISOString() });
        started = true;
      }, () => privateJson(`${attempt}.applied`, { appliedAt: ctx.now().toISOString() }));
      privateJson(`${attempt}.succeeded`, { completedAt: ctx.now().toISOString() });
    }
    return updated;
  } catch (err) {
    // Before an apply, rollback only our exact bytes. Once apply can have run,
    // retain desired configuration/state for safe recovery and prohibit retries.
    if (!started && readFileSync(path, 'utf8') === next) writeFileSync(path, original);
    throw err;
  }
}
