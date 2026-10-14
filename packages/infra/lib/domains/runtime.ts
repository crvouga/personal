import { DEFAULT_HEALTH_OPTIONS } from '../health/context.js';
import { createHealthContext } from '../health/ports.js';
import { loadServicesConfig } from '../services.js';
import { ownerCodes } from './inputs.js';

/** Reuse existing credentials, without copying unrelated application secrets. */
export async function migrationContext(repoRoot: string) {
  const config = loadServicesConfig();
  const base = createHealthContext({ config, repoRoot, options: DEFAULT_HEALTH_OPTIONS });
  const env = { ...process.env };
  const kv = await base.kv('dev');
  const aliases: Readonly<Record<string, string>> = {
    TF_VAR_cloudflare_api_token: 'CLOUDFLARE_API_TOKEN', TF_VAR_cloudflare_account_id: 'CLOUDFLARE_ACCOUNT_ID',
    TF_VAR_cloudflare_zone_id: 'CLOUDFLARE_ZONE_ID', TF_VAR_railway_token: 'RAILWAY_TOKEN',
    TF_VAR_github_token: 'GITHUB_TOKEN', TF_VAR_planetscale_service_token_id: 'PLANETSCALE_SERVICE_TOKEN_ID',
    TF_VAR_planetscale_service_token: 'PLANETSCALE_SERVICE_TOKEN', TF_VAR_state_passphrase: 'TOFU_STATE_PASSPHRASE',
    TF_VAR_state_access_key: 'TOFU_STATE_ACCESS_KEY', TF_VAR_state_secret_key: 'TOFU_STATE_SECRET_KEY',
    TF_VAR_vault_inputs: 'TOFU_VAULT_INPUTS',
  };
  // Explicit environment aliases take precedence over the Vault fallback.
  env['TF_VAR_cloudflare_api_token'] ??= env['CF_API_TOKEN'] ?? env['CLOUDFLARE_API_TOKEN'];
  env['TF_VAR_cloudflare_account_id'] ??= env['CLOUDFLARE_ACCOUNT_ID'];
  for (const [target, source] of Object.entries(aliases)) env[target] ??= env[source] ?? (kv.ok ? kv.data[source] : undefined);
  env['AWS_ACCESS_KEY_ID'] ??= env['TF_VAR_state_access_key'];
  env['AWS_SECRET_ACCESS_KEY'] ??= env['TF_VAR_state_secret_key'];
  env['TF_VAR_github_token'] ??= base.githubToken();
  env['API_DATA_IS_SENSITIVE'] = 'true';
  env['TF_VAR_domain_auth_codes'] = ownerCodes(repoRoot, env);
  return createHealthContext({ config, repoRoot, options: DEFAULT_HEALTH_OPTIONS, env });
}
