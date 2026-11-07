import { join, resolve } from 'node:path';
import { homedir, hostname } from 'node:os';
import { FleetUsageError } from '../../../fleet/src/errors';
import { object, read } from './files';

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

function validateInstance(id: string, value: unknown): void {
  const instance = object(JSON.stringify(value));
  const config = object(JSON.stringify(instance['config']));
  const env = instance['environment'];
  if (
    !/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(id) ||
    !['codex', 'opencode'].includes(String(instance['driver'])) ||
    typeof instance['displayName'] !== 'string' ||
    typeof instance['enabled'] !== 'boolean' ||
    Object.keys(instance).some(
      (key) =>
        !['driver', 'displayName', 'enabled', 'config', 'environment'].includes(
          key
        )
    ) ||
    !validConfig(config, String(instance['driver'])) ||
    !validEnvironment(env)
  )
    throw new FleetUsageError(
      'Invalid T3 instance definition; only the supported Codex/OpenCode adapter fields are accepted.'
    );
}

function validConfig(config: Record<string, unknown>, driver: string): boolean {
  return (
    Object.keys(config).every((key) =>
      ['binaryPath', 'homePath'].includes(key)
    ) &&
    typeof config['binaryPath'] === 'string' &&
    (driver === 'opencode'
      ? config['homePath'] === undefined
      : typeof config['homePath'] === 'string')
  );
}

function validEnvironment(env: unknown): boolean {
  if (!Array.isArray(env) || env.length !== 1) return false;
  const variable = object(JSON.stringify(env[0]));
  return (
    variable['name'] === 'WS_AGENT_NODE' &&
    variable['value'] === '${node}' &&
    variable['sensitive'] === false &&
    Object.keys(variable).length === 3
  );
}
