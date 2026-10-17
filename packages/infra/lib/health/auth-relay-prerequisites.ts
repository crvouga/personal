/** Read-only preflight checks, including before a broker has been deployed. */
import type { AuthRelayConfig } from '../schema.js';
import type { HealthContext } from './context.js';
import { fail, pass, skip, type CheckResult } from './report.js';

export function relayConfiguration(ctx: HealthContext, config: AuthRelayConfig): CheckResult {
  const instances = Object.values(config.instances);
  const problems: string[] = [];
  const configs = ctx.config.vault?.kv.configs ?? ['dev', 'prd'];
  if (!config.instances['production'] || !config.instances['nonproduction']) problems.push('production and nonproduction instances are required');
  if (new Set(instances.map((instance) => instance.hostname)).size !== instances.length) problems.push('broker hostnames must be distinct');
  if (new Set(instances.flatMap((instance) => [instance.database_schema, instance.console_database_schema])).size !== instances.length * 2) problems.push('database schemas must be distinct');
  if (new Set(instances.map((instance) => instance.setup_token_key)).size !== instances.length) problems.push('setup credentials must be distinct by environment');
  for (const [name, instance] of Object.entries(config.instances)) {
    if (instance.console_database_schema !== `auth_relay_${name}` || instance.console_database_schema === instance.database_schema) problems.push(`${name}: console needs its own isolated schema`);
    if (!instance.setup_token_key?.trim()) problems.push(`${name}: setup credential field is required`);
    try {
      const url = new URL(`https://${instance.hostname}`);
      if (url.hostname !== instance.hostname || url.pathname !== '/' || url.search || url.hash) throw new Error();
    } catch {
      problems.push(`${name}: invalid public hostname`);
    }
    if (typeof instance.realm !== 'string' || !/^[A-Za-z0-9_-]+$/.test(instance.realm)) problems.push(`${name}: invalid realm name`);
    if (typeof instance.database_schema !== 'string' || !/^[a-z][a-z0-9_]*$/.test(instance.database_schema)) problems.push(`${name}: invalid database schema`);
    if (!configs.includes(instance.vault_config)) problems.push(`${name}: unknown Vault config`);
    if (!instance.google_client_id_key?.trim() || !instance.google_client_secret_key?.trim() || instance.google_client_id_key === instance.google_client_secret_key) problems.push(`${name}: distinct Google credential field names are required`);
    const keys = Object.values(instance.signing_key_generations ?? {});
    if (!keys.some((key) => key.active) || keys.some((key) => !Number.isInteger(key.priority) || key.priority <= 100) || new Set(keys.map((key) => key.priority)).size !== keys.length) {
      problems.push(`${name}: signing keys need an active generation and distinct priorities above 100`);
    }
  }
  return problems.length > 0
    ? fail('auth-relay configuration', problems.join('; '))
    : pass('auth-relay configuration', 'isolated broker hosts/schemas, declared Vault configs and active signing-key generations');
}

export async function relayCredentials(ctx: HealthContext, config: AuthRelayConfig): Promise<readonly CheckResult[]> {
  const kv = ctx.config.vault?.kv ?? { mount: 'secret', project: 'personal' };
  return Promise.all(Object.entries(config.instances).map(async ([instanceName, instance]) => {
    const name = `${instanceName} credentials`;
    const path = `${kv.mount}/data/${kv.project}/${instance.vault_config}`;
    try {
      // Read the actual Vault document, never process.env or a local fallback.
      const doc = await ctx.kv(instance.vault_config);
      if (!doc.ok) {
        return doc.unverifiable
          ? skip(name, `${path}: Vault access unavailable; credential presence not verified`)
          : fail(name, `${path}: Vault document unavailable; credential presence not verified`);
      }
      const expected = [instance.google_client_id_key, instance.google_client_secret_key, instance.setup_token_key,
        'AUTH_RELAY_DATABASE_URL', 'AUTH_CONSOLE_CLIENT_ID', 'AUTH_CONSOLE_CLIENT_SECRET', 'AUTH_MANAGER_CLIENT_ID', 'AUTH_MANAGER_CLIENT_SECRET'];
      const missing = expected.filter((key) => !doc.data[key]?.trim());
      return missing.length > 0
        ? fail(name, `${path}: missing or empty ${missing.join(', ')}`)
        : pass(name, `${path}: required Google and console credential fields are non-empty; live sign-in not verified`);
    } catch {
      // Transport/provider errors may contain secrets: never echo their text.
      return fail(name, `${path}: Vault read failed; credential presence not verified`);
    }
  }));
}
