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
/** The singleton manager: the human's machine. It runs fleet-sync and hosts
 * every singleton service; it is never converged over SSH. */
export interface ManagerDefinition {
  id: string;
  os: 'macOS';
  network: { tailscaleName: string; user: string };
  neverSleepOnPower: true;
}
export interface FleetDefinition {
  version: 3;
  manager: ManagerDefinition;
  /** Stateless, replaceable Linux boxes; clients of the manager's services. */
  workers: MachineDefinition[];
  services: {
    proxy: { endpoint: 'https://cli-proxy.chrisvouga.dev' };
    monitoring: { hubPort: 8443 };
  };
  worker?: WorkerPolicy;
  ubuntu: { release: '26.04'; architectures: ['amd64', 'arm64'] };
}
const ID = /^[a-z][a-z0-9-]{0,62}$/;
const HOST = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,252}$/;
function fail(): never {
  throw new FleetUsageError(
    'Invalid Fleet definition. Check version 3, one macOS manager, unique Linux worker IDs, singleton services and network metadata in packages/fleet/definition.json.'
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
function worker(value: unknown): MachineDefinition {
  if (!record(value) || !keys(value, ['id', 'ssh', 'os', 'network']))
    return fail();
  if (typeof value['id'] !== 'string' || !ID.test(value['id'])) return fail();
  if (typeof value['ssh'] !== 'string' || !HOST.test(value['ssh']))
    return fail();
  // Workers are the Linux boxes; any other platform is not a worker.
  if (value['os'] !== 'linux') return fail();
  return {
    id: value['id'],
    ssh: value['ssh'],
    os: 'linux',
    ...(value['network'] ? { network: network(value['network']) } : {}),
  };
}
function manager(value: unknown): ManagerDefinition {
  if (
    !record(value) ||
    !keys(value, ['id', 'os', 'network', 'neverSleepOnPower']) ||
    typeof value['id'] !== 'string' ||
    !ID.test(value['id']) ||
    value['os'] !== 'macOS' ||
    value['neverSleepOnPower'] !== true
  )
    return fail();
  return {
    id: value['id'],
    os: 'macOS',
    network: managerNetwork(value['network']),
    neverSleepOnPower: true,
  };
}
function managerNetwork(value: unknown): ManagerDefinition['network'] {
  if (
    !record(value) ||
    !keys(value, ['tailscaleName', 'user']) ||
    typeof value['tailscaleName'] !== 'string' ||
    !HOST.test(value['tailscaleName']) ||
    typeof value['user'] !== 'string' ||
    !/^[a-z_][a-z0-9_.-]{0,31}$/.test(value['user'])
  )
    return fail();
  return { tailscaleName: value['tailscaleName'], user: value['user'] };
}
export function parseDefinition(value: unknown): FleetDefinition {
  if (
    !record(value) ||
    value['version'] !== 3 ||
    !keys(value, [
      '$schema',
      'version',
      'manager',
      'workers',
      'services',
      'ubuntu',
      'worker',
    ])
  )
    return fail();
  if (!Array.isArray(value['workers']) || value['workers'].length > 64)
    return fail();
  const lead = manager(value['manager']);
  const workers = value['workers'].map(worker);
  const ids = [lead.id, ...workers.map((entry) => entry.id)];
  if (new Set(ids).size !== ids.length) return fail();
  return {
    version: 3,
    manager: lead,
    workers,
    services: services(value['services']),
    ubuntu: baseline(value['ubuntu']),
    ...(value['worker'] === undefined
      ? {}
      : { worker: parseWorkerPolicy(value['worker']) }),
  };
}
/** Singleton services name no host: they always run on the manager. */
function services(value: unknown): FleetDefinition['services'] {
  if (!record(value) || !keys(value, ['proxy', 'monitoring'])) return fail();
  const { proxy, monitoring } = value;
  if (
    !record(proxy) ||
    !keys(proxy, ['endpoint']) ||
    proxy['endpoint'] !== 'https://cli-proxy.chrisvouga.dev'
  )
    return fail();
  if (
    !record(monitoring) ||
    !keys(monitoring, ['hubPort']) ||
    monitoring['hubPort'] !== 8443
  )
    return fail();
  return {
    proxy: { endpoint: 'https://cli-proxy.chrisvouga.dev' },
    monitoring: { hubPort: 8443 },
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
/** Local v1 roster supplies paths/requirements only for explicitly enrolled workers. */
export function enrolledRoster(
  definition: FleetDefinition,
  overrides: unknown
): FleetConfig {
  const roster = parseConfig(overrides);
  for (const node of roster.nodes) {
    const declared = definition.workers.find((entry) => entry.id === node.id);
    if (!declared)
      throw new FleetUsageError(
        'Roster contains a node that is not a declared worker. Add the worker to packages/fleet/definition.json in Git before rollout; the manager is never a roster node.'
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
