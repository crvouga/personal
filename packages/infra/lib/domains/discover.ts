import { mapLimit, type HealthContext } from '../health/context.js';
import { delegation, query, answers } from './dns.js';
import { rdap } from './checks.js';
import { migrationProgress } from './progress.js';

/** Public observations are not a zone backup or an account inventory. */
export async function discover(ctx: HealthContext) {
  return mapLimit(Object.entries(ctx.config.domains ?? {}), 3, async ([domain, spec]) => {
    migrationProgress('public-discovery', 'Collecting public delegation, RDAP and HTTPS observations', domain);
    const observe = async (task: () => Promise<unknown>) => {
      try { return await task(); } catch (err) { return { error: err instanceof Error ? err.message : 'Probe failed' }; }
    };
    return {
      domain, observedAt: ctx.now().toISOString(),
      delegation: await observe(() => delegation(ctx, domain)),
      dns: await observe(async () => Object.fromEntries(await Promise.all(['NS', 'DS', 'MX'].map(async (type) =>
        [type, answers(await query(ctx, '1.1.1.1', domain, type, true), domain, type)])))),
      registration: await observe(async () => {
        const value = await rdap(ctx, domain);
        // Never persist the RDAP contact document.
        return { status: value.status, events: value.events };
      }),
      https: await Promise.all(spec.https.map(async (endpoint) => ({ url: endpoint.url, expected: endpoint.status,
        observation: await observe(async () => {
          const response = await ctx.fetch(endpoint.url, { redirect: 'manual', signal: AbortSignal.timeout(ctx.options.timeoutMs) });
          await response.body?.cancel();
          return { status: response.status, location: response.headers.get('location'), healthy: response.status === endpoint.status && (!endpoint.location || endpoint.location === response.headers.get('location')) };
        }),
      }))),
    };
  });
}
