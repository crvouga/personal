/** Automatic timestamps are local evidence, never infrastructure mutations. */
import { existsSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { asRecord, type HealthContext } from '../health/context.js';
import { absentDs } from './checks.js';
import { findZone } from './cloudflare.js';
import { answers, delegation, query, sameSet } from './dns.js';
import { baseline, digest, directory, privateJson, readJson } from './files.js';
import { normalizeName, RESOLVERS } from './model.js';

export function freeze(ctx: HealthContext, domain: string): string {
  const at = ctx.now().toISOString();
  privateJson(join(directory(ctx.repoRoot, domain), 'freeze.json'), { freezeStartedAt: at });
  return at;
}

export async function observe(ctx: HealthContext, domain: string): Promise<void> {
  const hash = digest(baseline(ctx.repoRoot, domain));
  const path = join(directory(ctx.repoRoot, domain), 'observations.json');
  const previous = existsSync(path) ? asRecord(readJson(path)) : {};
  const old = previous.baselineHash === hash ? previous : {};
  let dsAbsentSince = '';
  let delegationChangedAt = '';
  try {
    await absentDs(ctx, domain);
    dsAbsentSince = String(old.dsAbsentSince || ctx.now().toISOString());
  } catch { /* Absence not observed; invalidate the timer rather than guessing. */ }
  try {
    const zone = await findZone(ctx, domain);
    const expected = zone.name_servers.map(normalizeName);
    if (zone.status !== 'active' || !sameSet((await delegation(ctx, domain)).servers, expected)) throw new Error('Delegation not active');
    for (const server of RESOLVERS) {
      if (!sameSet(answers(await query(ctx, server, domain, 'NS', true), domain, 'NS').map((record) => normalizeName(record.value)), expected)) throw new Error('Delegation not converged');
    }
    delegationChangedAt = String(old.delegationChangedAt || ctx.now().toISOString());
  } catch { /* No completed delegation observation, so no soak timer. */ }
  const next = `${path}.${crypto.randomUUID()}.tmp`;
  privateJson(next, { baselineHash: hash, observedAt: ctx.now().toISOString(), dsAbsentSince, delegationChangedAt });
  renameSync(next, path);
}
