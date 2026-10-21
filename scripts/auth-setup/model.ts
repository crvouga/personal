// Pure pieces of `bun run auth:setup`: what to register, which inventory lines to
// write and how to wait. Nothing here touches the network or a terminal.
export type RelayInstance = {
  readonly hostname: string;
  readonly realm: string;
  readonly console_database_schema: string;
  readonly vault_config: string;
  readonly setup_token_key: string;
};
export type Inventory = {
  readonly auth_relay: {
    readonly instances: Readonly<Record<string, RelayInstance>>;
  };
  readonly services: readonly {
    readonly id: string;
    readonly hostname?: string;
    readonly env?: Readonly<Record<string, string>>;
  }[];
};

export const FLEET_SERVICE = 'fleet-api';
// The identity the operator types into the relay UI; the helper finds the client
// again by these three fields, which are immutable once registered.
export const FLEET_IDENTITY = {
  name: 'Fleet',
  project: 'fleet',
  environment: 'production',
  instance: 'production',
} as const;

const DAY = 86_400_000;
// The relay caps production leases at 366 days; stay one day inside the limit.
export const LEASE_DAYS = 365;

export function leaseExpiry(now: Date): string {
  return new Date(now.getTime() + LEASE_DAYS * DAY).toISOString().slice(0, 10);
}

export function fleetRegistration(inventory: Inventory, now: Date) {
  const service = inventory.services.find((s) => s.id === FLEET_SERVICE);
  if (!service?.hostname) throw new Error(`${FLEET_SERVICE} has no hostname`);
  const relay = inventory.auth_relay.instances['production'];
  if (!relay) throw new Error('no production auth relay instance');
  const origin = `https://${service.hostname}`;
  return {
    ...FLEET_IDENTITY,
    relay,
    origin,
    callback: `${origin}/auth/callback`,
    issuer: `https://${relay.hostname}/realms/${relay.realm}`,
    expires: leaseExpiry(now),
  };
}

/** Google only ever sees each relay's fixed broker endpoint. */
export function googleCallbacks(inventory: Inventory): string[] {
  return Object.values(inventory.auth_relay.instances).map(
    (i) => `https://${i.hostname}/realms/${i.realm}/broker/google/endpoint`
  );
}

export function fleetEnv(
  registration: ReturnType<typeof fleetRegistration>,
  clientId: string
): Record<string, string> {
  if (!/^app-[a-f0-9-]{36}$/.test(clientId))
    throw new Error(`Unexpected client ID shape: ${clientId}`);
  return {
    FLEET_OIDC_ISSUER: registration.issuer,
    FLEET_OIDC_CLIENT_ID: clientId,
    FLEET_PUBLIC_ORIGIN: registration.origin,
  };
}

/** Schema names are interpolated into SQL, so only accept plain identifiers. */
export function schemaName(instance: RelayInstance): string {
  const name = instance.console_database_schema;
  if (!/^[a-z][a-z0-9_]*$/.test(name))
    throw new Error(`Unsafe schema name: ${name}`);
  return name;
}

/**
 * Add or update keys in one service's `env` object, leaving every other byte of
 * the inventory untouched so the diff is only the new lines.
 */
export function withServiceEnv(
  text: string,
  serviceId: string,
  additions: Readonly<Record<string, string>>
): string {
  const start = text.indexOf(`"id": ${JSON.stringify(serviceId)}`);
  if (start < 0) throw new Error(`service ${serviceId} not found`);
  const open = text.indexOf('"env": {', start);
  const next = text.indexOf('"id":', start + 1);
  if (open < 0 || (next >= 0 && open > next))
    throw new Error(`service ${serviceId} has no env object`);
  const bodyStart = open + '"env": {'.length;
  const bodyEnd = text.indexOf('}', bodyStart);
  const lineStart = text.lastIndexOf('\n', open) + 1;
  const indent = text.slice(lineStart, open);
  const current = JSON.parse(`{${text.slice(bodyStart, bodyEnd)}}`) as Record<
    string,
    string
  >;
  const merged = { ...current, ...additions };
  const lines = Object.entries(merged).map(
    ([key, value]) =>
      `${indent}  ${JSON.stringify(key)}: ${JSON.stringify(value)}`
  );
  return `${text.slice(0, bodyStart)}\n${lines.join(',\n')}\n${indent}${text.slice(bodyEnd)}`;
}

export function configuredEnv(
  inventory: Inventory
): Readonly<Record<string, string>> {
  return inventory.services.find((s) => s.id === FLEET_SERVICE)?.env ?? {};
}

export async function poll<T>(
  attempt: () => Promise<T | undefined>,
  options: {
    timeoutMs: number;
    intervalMs: number;
    sleep?: (ms: number) => Promise<unknown>;
  }
): Promise<T | undefined> {
  const sleep = options.sleep ?? Bun.sleep;
  for (let waited = 0; ; waited += options.intervalMs) {
    const value = await attempt();
    if (value !== undefined) return value;
    if (waited + options.intervalMs > options.timeoutMs) return undefined;
    await sleep(options.intervalMs);
  }
}

/** Fleet renders this sentence when its relay settings are missing. */
export function fleetSignInAvailable(loginHtml: string): boolean {
  return (
    loginHtml.includes('Continue with Google') &&
    !loginHtml.includes('Google sign-in is unavailable')
  );
}
