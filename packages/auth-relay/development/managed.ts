import type { AuthRelayConfig } from '../../infra/lib/schema';
import { managedSettings } from './managed-settings';

const inventory = (await Bun.file(
  new URL(
    '../../infra/tofu/modules/inventory/inventory.tf.json',
    import.meta.url
  )
).json()) as { locals: { inventory: { auth_relay?: AuthRelayConfig } } };
const relay = inventory.locals.inventory.auth_relay;
if (!relay)
  throw new Error('No auth relay is declared in the managed inventory');
const scope =
  process.argv[2] ??
  process.env['AUTH_VAULT_CONFIG'] ??
  process.env['VAULT_CONFIG'] ??
  'dev';
const { env, missing, enabled } = managedSettings(process.env, scope, relay);
if (missing.length) {
  console.error(`Managed auth relay cannot start: missing Vault fields in secret/data/personal/${scope}: ${missing.join(', ')}.
Deployment is ${enabled ? 'enabled' : 'disabled'} in the canonical inventory. Hostname, realm and upstream are resolved from inventory; these are not missing local .env settings.
Provision the reviewed auth resources and Vault projection before retrying. Run: bun run health -- --only auth
See packages/auth-relay/operations.md. No mock fallback was started.`);
  process.exit(1);
}
// Private upstream reachability and routing through the registered issuer origin
// are still required; a random localhost origin cannot reuse its callback.
Object.assign(process.env, env, { AUTH_DEV_MODE: 'configured' });
await import('./start');
