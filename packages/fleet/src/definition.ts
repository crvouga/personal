import { parseWorkerPolicy, type WorkerPolicy } from './worker-policy';
import { readFileSync } from 'node:fs';
import { FleetUsageError } from './errors';
import { parseConfig, record } from './config';
import type { FleetConfig } from './types';

export interface MachineDefinition {
  id: string;
  ssh: string;
  os: 'linux' | 'macOS' | 'windows';
  network?: {
    tailscaleName: string;
    user: string;
    sshPort: number;
    t3Port: number;
  };
}
export interface FleetDefinition {
  version: 2;
  worker?: WorkerPolicy;
  nodes: MachineDefinition[];
  proxy: { owner: string; endpoint: 'https://cli-proxy.chrisvouga.dev' };
  monitoring: { parent: string };
  ubuntu: { release: '26.04'; architectures: ['amd64', 'arm64'] };
}
const ID = /^[a-z][a-z0-9-]{0,62}$/;
const HOST = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,252}$/;
function fail(): never {
  throw new FleetUsageError(
    'Invalid Fleet definition. Check version 2, unique node IDs, singleton owners, and network metadata in packages/fleet/definition.json.'
  );
}
function keys(value: Record<string, unknown>, allowed: string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}
function network(value: unknown): NonNullable<MachineDefinition['network']> {
  if (
    !record(value) ||
    !keys(value, ['tailscaleName', 'user', 'sshPort', 't3Port'])
  )
    return fail();
  if (
    typeof value['tailscaleName'] !== 'string' ||
    !HOST.test(value['tailscaleName'])
  )
    return fail();
  if (
    typeof value['user'] !== 'string' ||
    !/^[a-z_][a-z0-9_-]{0,31}$/.test(value['user'])
  )
    return fail();
  for (const port of ['sshPort', 't3Port'])
    if (!validPort(value[port])) return fail();
  return value as NonNullable<MachineDefinition['network']>;
}
function validPort(value: unknown): boolean {
  return (
    Number.isInteger(value) && Number(value) >= 1 && Number(value) <= 65535
  );
}
function node(value: unknown): MachineDefinition {
  if (!record(value) || !keys(value, ['id', 'ssh', 'os', 'network']))
    return fail();
  if (typeof value['id'] !== 'string' || !ID.test(value['id'])) return fail();
  if (typeof value['ssh'] !== 'string' || !HOST.test(value['ssh']))
    return fail();
  if (!['linux', 'macOS', 'windows'].includes(String(value['os'])))
    return fail();
  return {
    id: value['id'],
    ssh: value['ssh'],
    os: value['os'] as MachineDefinition['os'],
    ...(value['network'] ? { network: network(value['network']) } : {}),
  };
}
export function parseDefinition(value: unknown): FleetDefinition {
  if (
    !record(value) ||
    value['version'] !== 2 ||
    !keys(value, [
      '$schema',
      'version',
      'nodes',
      'proxy',
      'monitoring',
      'ubuntu',
      'worker',
    ])
  )
    return fail();
  if (!Array.isArray(value['nodes']) || value['nodes'].length > 64)
    return fail();
  const nodes = value['nodes'].map(node);
  if (
    !nodes.length ||
    new Set(nodes.map((entry) => entry.id)).size !== nodes.length
  )
    return fail();
  const { proxy, monitoring } = owners(value, nodes);
  const ubuntu = baseline(value['ubuntu']);
  return {
    version: 2,
    nodes,
    proxy,
    monitoring,
    ubuntu,
    ...(value['worker'] === undefined
      ? {}
      : { worker: parseWorkerPolicy(value['worker']) }),
  };
}
function owners(
  value: Record<string, unknown>,
  nodes: MachineDefinition[]
): Pick<FleetDefinition, 'proxy' | 'monitoring'> {
  const proxy = value['proxy'];
  const monitoring = value['monitoring'];
  if (
    !record(proxy) ||
    !keys(proxy, ['owner', 'endpoint']) ||
    proxy['endpoint'] !== 'https://cli-proxy.chrisvouga.dev'
  )
    return fail();
  if (!record(monitoring) || !keys(monitoring, ['parent'])) return fail();
  for (const id of [proxy['owner'], monitoring['parent']])
    if (!nodes.some((entry) => entry.id === id && entry.os === 'linux'))
      return fail();
  return {
    proxy: proxy as FleetDefinition['proxy'],
    monitoring: monitoring as FleetDefinition['monitoring'],
  };
}
function baseline(ubuntu: unknown): FleetDefinition['ubuntu'] {
  if (
    !record(ubuntu) ||
    !keys(ubuntu, ['release', 'architectures']) ||
    ubuntu['release'] !== '26.04' ||
    JSON.stringify(ubuntu['architectures']) !== '["amd64","arm64"]'
  )
    return fail();
  return ubuntu as FleetDefinition['ubuntu'];
}

export function loadDefinition(path: string): FleetDefinition {
  try {
    return parseDefinition(JSON.parse(readFileSync(path, 'utf8')));
  } catch {
    return fail();
  }
}
/** Local v1 roster supplies paths/requirements only for explicitly enrolled nodes. */
export function enrolledRoster(
  definition: FleetDefinition,
  overrides: unknown
): FleetConfig {
  const roster = parseConfig(overrides);
  for (const node of roster.nodes) {
    const declared = definition.nodes.find((entry) => entry.id === node.id);
    if (!declared)
      throw new FleetUsageError(
        'Roster contains a node missing from the reviewed Fleet definition. Add its portable definition in Git before rollout.'
      );
    if (declared.ssh !== node.ssh)
      throw new FleetUsageError(
        'Fleet SSH assignment conflicts with the local roster. Review the migration; discovery cannot overwrite explicit assignments.'
      );
  }
  return {
    ...roster,
    nodes: roster.nodes.map((node) => ({
      ...node,
      required: [
        ...new Set([
          ...node.required,
          ...(definition.worker?.requiredCapabilities ?? []),
        ]),
      ],
    })),
  };
}
