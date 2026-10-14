import { DEFAULT_HEALTH_OPTIONS } from '../health/context.js';
import { createHealthContext } from '../health/ports.js';
import { loadServicesConfig } from '../services.js';

/** Reuse existing Vault authentication, copying only the two Cloudflare inputs. */
export async function migrationContext(repoRoot: string) {
  const config = loadServicesConfig();
  const base = createHealthContext({ config, repoRoot, options: DEFAULT_HEALTH_OPTIONS });
  const env = { ...process.env };
  if (!(env['CF_API_TOKEN'] || env['CLOUDFLARE_API_TOKEN'] || env['TF_VAR_cloudflare_api_token']) ||
    !(env['CLOUDFLARE_ACCOUNT_ID'] || env['TF_VAR_cloudflare_account_id'])) {
    const kv = await base.kv('dev');
    if (kv.ok) {
      env['CLOUDFLARE_API_TOKEN'] ??= kv.data['CLOUDFLARE_API_TOKEN'];
      env['CLOUDFLARE_ACCOUNT_ID'] ??= kv.data['CLOUDFLARE_ACCOUNT_ID'];
    }
  }
  env['TF_VAR_cloudflare_api_token'] ??= env['CF_API_TOKEN'] ?? env['CLOUDFLARE_API_TOKEN'];
  env['TF_VAR_cloudflare_account_id'] ??= env['CLOUDFLARE_ACCOUNT_ID'];
  return createHealthContext({ config, repoRoot, options: DEFAULT_HEALTH_OPTIONS, env });
}
