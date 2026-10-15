import { DEFAULT_HEALTH_OPTIONS } from '../health/context.js';
import { createHealthContext } from '../health/ports.js';
import { loadServicesConfig } from '../services.js';

/** Read-only domain tools need only Cloudflare read access, never transfer or state inputs. */
export async function domainContext(repoRoot: string) {
  const config = loadServicesConfig();
  const base = createHealthContext({ config, repoRoot, options: DEFAULT_HEALTH_OPTIONS });
  const kv = await base.kv('dev');
  const env = { ...process.env };
  env['TF_VAR_cloudflare_api_token'] ??= env['CF_API_TOKEN'] ?? env['CLOUDFLARE_API_TOKEN'] ?? (kv.ok ? kv.data['CLOUDFLARE_API_TOKEN'] : undefined);
  env['TF_VAR_cloudflare_account_id'] ??= env['CLOUDFLARE_ACCOUNT_ID'] ?? (kv.ok ? kv.data['CLOUDFLARE_ACCOUNT_ID'] : undefined);
  return createHealthContext({ config, repoRoot, options: DEFAULT_HEALTH_OPTIONS, env });
}
