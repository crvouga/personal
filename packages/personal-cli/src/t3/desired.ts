import { join, resolve } from 'node:path';
import { homedir, hostname } from 'node:os';
import { FleetUsageError } from '../../../fleet/src/errors';
import { object, read } from './files';
import registry from '../../../workstation/agents/registry.json';

/** T3's marker for a credential kept in its per-host secret store. */
export const T3_SAVED_SECRET = '••••••';

export interface T3Options {
  id?: string;
  t3Home?: string;
  definition?: string;
  planHash?: string;
  dryRun?: boolean;
  import?: string;
}

export function nodeId(value?: string): string {
  const id =
    value ??
    hostname()
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '-')
      .slice(0, 63);
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(id))
    throw new FleetUsageError('Invalid node ID. Use --id NAME.');
  return id;
}

export function paths(options: T3Options, workspace: string) {
  const base = resolve(
    options.t3Home ?? process.env['T3CODE_HOME'] ?? join(homedir(), '.t3')
  );
  return {
    settings: join(base, 'userdata/settings.json'),
    state: join(base, 'userdata/personal-managed.json'),
    definition: resolve(
      options.definition ??
        join(workspace, 'packages/workstation/agents/t3.json')
    ),
  };
}

export async function desired(path: string, workspace: string, id: string) {
  const raw = await read(path);
  if (raw === null)
    throw new FleetUsageError('T3 definition is missing in this checkout.');
  const doc = object(raw);
  if (
    doc['version'] !== 1 ||
    Object.keys(doc).some((key) => !['version', 'instances'].includes(key))
  )
    throw new FleetUsageError(
      'Unsupported T3 definition. Expected version 1 and instances.'
    );
  const instances = object(JSON.stringify(doc['instances'] ?? null));
  for (const [key, value] of Object.entries(instances))
    validateInstance(key, value);
  const agents =
    process.platform === 'win32'
      ? join(homedir(), 'AppData/Local/personal/agents')
      : join(homedir(), '.config/personal/agents');
  const variables: Record<string, string> = {
    workspace: resolve(workspace),
    agents,
    node: id,
  };
  // Substitute individual strings, not serialized JSON: paths may contain quotes/backslashes.
  return expand(instances, variables) as Record<string, unknown>;
}

function expand(value: unknown, variables: Record<string, string>): unknown {
  if (typeof value === 'string')
    return value.replace(/\$\{([^}]+)\}/g, (_, key: string) => {
      if (!(key in variables))
        throw new FleetUsageError('Unknown variable in T3 definition.');
      return variables[key]!;
    });
  if (Array.isArray(value)) return value.map((item) => expand(item, variables));
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, expand(item, variables)])
    );
  return value;
}

/** Each managed driver accepts only the adapter fields fleet sets. Credentials
 * never appear here (T3 refuses a managed policy that holds one): wrappers read
 * them from Vault at launch, and Antigravity's key is the saved-secret marker,
 * resolved from T3's per-host secret store that fleet fills from Vault.
 */
const DRIVERS: Record<
  string,
  {
    required: string[];
    fixed?: Record<string, string>;
    env?: Record<string, string>;
  }
> = {
  codex: { required: ['binaryPath', 'homePath'] },
  opencode: { required: ['binaryPath'] },
  claudeAgent: { required: ['binaryPath', 'homePath'] },
  grok: { required: ['binaryPath'], env: { XAI_API_KEY: 'fleet-cli-proxy' } },
  antigravity: {
    required: ['authMethod', 'apiKey'],
    fixed: { authMethod: 'gemini-api-key', apiKey: T3_SAVED_SECRET },
    env: { GOOGLE_GEMINI_BASE_URL: registry.proxy.endpoint },
  },
};

function validateInstance(id: string, value: unknown): void {
  const instance = object(JSON.stringify(value));
  const config = object(JSON.stringify(instance['config']));
  const driver = DRIVERS[String(instance['driver'])];
  if (
    !/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(id) ||
    !driver ||
    typeof instance['displayName'] !== 'string' ||
    typeof instance['enabled'] !== 'boolean' ||
    Object.keys(instance).some(
      (key) =>
        !['driver', 'displayName', 'enabled', 'config', 'environment'].includes(
          key
        )
    ) ||
    !validConfig(config, driver) ||
    !validEnvironment(instance['environment'], driver.env ?? {})
  )
    throw new FleetUsageError(
      'Invalid T3 instance definition; only the supported managed adapter fields are accepted.'
    );
}

function validConfig(
  config: Record<string, unknown>,
  driver: { required: string[]; fixed?: Record<string, string> }
): boolean {
  return (
    Object.keys(config).every((key) => driver.required.includes(key)) &&
    driver.required.every((key) => typeof config[key] === 'string') &&
    Object.entries(driver.fixed ?? {}).every(
      ([key, value]) => config[key] === value
    )
  );
}

/** WS_AGENT_NODE first, then exactly the driver's fixed non-secret values. */
function validEnvironment(
  env: unknown,
  fixed: Record<string, string>
): boolean {
  const extra = Object.entries(fixed);
  if (!Array.isArray(env) || env.length !== 1 + extra.length) return false;
  const [node, ...rest] = env.map((item) => object(JSON.stringify(item)));
  return (
    node!['name'] === 'WS_AGENT_NODE' &&
    node!['value'] === '${node}' &&
    node!['sensitive'] === false &&
    Object.keys(node!).length === 3 &&
    rest.every(
      (variable, index) =>
        variable['name'] === extra[index]![0] &&
        variable['value'] === extra[index]![1] &&
        variable['sensitive'] === false &&
        Object.keys(variable).length === 3
    )
  );
}
