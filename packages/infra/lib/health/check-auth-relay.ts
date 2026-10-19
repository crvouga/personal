/** Credential/configuration preflight plus public probes for deployed brokers. */
import { relayConfiguration, relayCredentials } from './auth-relay-prerequisites.js';
import { errorMessage, type HealthContext } from './context.js';
import { fail, pass, skip, type CheckResult } from './report.js';

export async function checkAuthRelay(ctx: HealthContext): Promise<readonly CheckResult[]> {
  const config = ctx.config.auth_relay;
  if (!config) return [skip('auth-relay', 'no authentication relay declared')];
  const configuration = relayConfiguration(ctx, config);
  if (configuration.status === 'fail') return [configuration];
  const prerequisites = [configuration, ...await relayCredentials(ctx, config)];
  if (!config.enabled) return [...prerequisites, skip('auth-relay', 'preproduction; live acceptance has not been completed')];
  if (config.live === false) return [...prerequisites, skip('auth-relay', 'identity service staged; public gateway not live until credentials are projected')];
  return [...prerequisites, ...await Promise.all(Object.entries(config.instances).map(async ([name, instance]) => {
    const base = `https://${instance.hostname}`;
    const issuer = `${base}/realms/${instance.realm}`;
    try {
      const get = async (url: string) => {
        const response = await ctx.fetch(url, { redirect: 'error', signal: AbortSignal.timeout(ctx.options.timeoutMs) });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response;
      };
      await get(`${base}/health/ready`);
      const doc = await (await get(`${issuer}/.well-known/openid-configuration`)).json() as Record<string, unknown>;
      if (doc.issuer !== issuer || doc.jwks_uri !== `${issuer}/protocol/openid-connect/certs` || doc.token_endpoint !== `${issuer}/protocol/openid-connect/token` || !(doc.code_challenge_methods_supported as string[] | undefined)?.includes('S256')) {
        return fail(name, 'OIDC issuer, endpoints or PKCE support differs from inventory');
      }
      const jwks = await (await get(String(doc.jwks_uri))).json() as { keys?: { kid?: string; use?: string }[] };
      if (!jwks.keys?.some((key) => key.kid && key.use === 'sig')) return fail(name, 'no published signing key');
      return pass(name, 'ready; expected OIDC issuer, S256 PKCE and signing keys published');
    } catch (error) {
      return fail(name, errorMessage(error));
    }
  }))];
}
