// Shared authentication relay bootstrap helpers.
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
};
/** Google only ever sees each relay's fixed broker endpoint. */
export function googleCallbacks(inventory: Inventory): string[] {
  return Object.values(inventory.auth_relay.instances).map(
    (i) => `https://${i.hostname}/realms/${i.realm}/broker/google/endpoint`
  );
}

/** Schema names are interpolated into SQL, so only accept plain identifiers. */
export function schemaName(instance: RelayInstance): string {
  const name = instance.console_database_schema;
  if (!/^[a-z][a-z0-9_]*$/.test(name))
    throw new Error(`Unsafe schema name: ${name}`);
  return name;
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
