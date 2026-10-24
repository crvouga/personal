import type { HealthContext } from './context.js';
import { fail, pass, type CheckResult } from './report.js';

/** Public reads only. This checks the deployed proxy and published cache index. */
export async function checkFleetCache(ctx: HealthContext): Promise<CheckResult[]> {
  const service = ctx.config.services.find((entry) => entry.id === 'turborepo');
  if (!service?.hostname) return [];
  const name = 'Fleet Nix cache';
  const url = `https://${service.hostname}/nix/nix-cache-info`;
  try {
    const reply = await ctx.fetch(url, { redirect: 'error', signal: AbortSignal.timeout(ctx.options.coldStartTimeoutMs) });
    if (!reply.ok) return [fail(name, `public cache index returned HTTP ${reply.status}; deploy the cache service and inspect Fleet cache publication`)];
    const text = await reply.text();
    if (text.length > 4096 || !/^StoreDir: \/nix\/store$/m.test(text)) return [fail(name, 'public cache index is invalid; installer preflight will refuse disk changes')];
    return [pass(name, 'public binary-cache index reachable; individual closures and signatures are checked by Nix')];
  } catch {
    return [fail(name, 'public cache index unreachable; inspect cache deployment and Fleet cache workflow')];
  }
}
