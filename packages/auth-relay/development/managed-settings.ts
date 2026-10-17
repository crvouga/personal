import type { AuthRelayConfig } from '../../infra/lib/schema';

/** Resolve deployment metadata, never create credentials or application clients. */
export function managedSettings(
  source: NodeJS.ProcessEnv,
  scope: string,
  relay: AuthRelayConfig
): { env: NodeJS.ProcessEnv; missing: string[]; enabled: boolean } {
  const instances = Object.entries(relay.instances).filter(
    ([, instance]) => instance.vault_config === scope
  );
  if (instances.length !== 1)
    throw new Error(
      'Select a Vault scope belonging to exactly one relay instance'
    );
  const [environment, instance] = instances[0]!;
  if (source['AUTH_ENVIRONMENT'] && source['AUTH_ENVIRONMENT'] !== environment)
    throw new Error('AUTH_ENVIRONMENT conflicts with the selected Vault scope');
  const env: NodeJS.ProcessEnv = {
    ...source,
    AUTH_ENVIRONMENT: environment,
    AUTH_ORIGIN: source['AUTH_ORIGIN'] ?? `https://${instance.hostname}`,
    AUTH_REALM: source['AUTH_REALM'] ?? instance.realm,
    AUTH_UPSTREAM:
      source['AUTH_UPSTREAM'] ??
      (instance.service
        ? `http://${instance.service.id}-identity.railway.internal:8080`
        : undefined),
    AUTH_DATABASE_URL:
      source['AUTH_DATABASE_URL'] ?? source['AUTH_RELAY_DATABASE_URL'],
    AUTH_SETUP_TOKEN:
      source['AUTH_SETUP_TOKEN'] ?? source[instance.setup_token_key],
  };
  const settings = {
    AUTH_ORIGIN: 'AUTH_ORIGIN',
    AUTH_UPSTREAM: 'AUTH_UPSTREAM',
    AUTH_REALM: 'AUTH_REALM',
    AUTH_DATABASE_URL: 'AUTH_RELAY_DATABASE_URL',
    AUTH_CONSOLE_CLIENT_ID: 'AUTH_CONSOLE_CLIENT_ID',
    AUTH_CONSOLE_CLIENT_SECRET: 'AUTH_CONSOLE_CLIENT_SECRET',
    AUTH_MANAGER_CLIENT_ID: 'AUTH_MANAGER_CLIENT_ID',
    AUTH_MANAGER_CLIENT_SECRET: 'AUTH_MANAGER_CLIENT_SECRET',
    AUTH_SETUP_TOKEN: instance.setup_token_key,
  };
  return {
    env,
    enabled: relay.enabled,
    missing: Object.entries(settings)
      .filter(([key]) => !env[key]?.trim())
      .map(([, key]) => key),
  };
}
