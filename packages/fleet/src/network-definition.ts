import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  loadDefinition,
  type FleetDefinition,
  type MachineDefinition,
} from './definition';
import { record } from './config';
import { FleetUsageError } from './errors';

export interface NetworkHost {
  alias: string;
  tailscaleName: string;
  sshPort: number;
  user: string;
  identityFile: string;
  os: 'linux' | 'macOS' | 'windows';
  t3Port: number;
}
export function networkProjection(
  definition: FleetDefinition,
  identities: Record<string, string>
): NetworkHost[] {
  return definition.nodes.flatMap((node) =>
    node.network
      ? [
          {
            alias: node.ssh,
            ...node.network,
            os: node.os,
            identityFile: identities[node.id] ?? '',
          },
        ]
      : []
  );
}
function compatible(
  node: MachineDefinition | undefined,
  host: Record<string, unknown>
): node is MachineDefinition {
  return Boolean(
    node?.network &&
    Object.entries(node.network).every(([key, value]) => host[key] === value) &&
    node.os === host['os']
  );
}
/** Immutable migration input supplies old controller paths only, never desired hosts. */
export function legacyIdentities(
  definition: FleetDefinition,
  raw: unknown
): Record<string, string> {
  if (!record(raw) || !Array.isArray(raw['hosts']))
    throw new FleetUsageError('Invalid legacy Workstation inventory.');
  const result: Record<string, string> = {};
  for (const host of raw['hosts']) {
    if (!record(host))
      throw new FleetUsageError('Invalid legacy network host.');
    const node = definition.nodes.find((node) => node.ssh === host['alias']);
    if (!compatible(node, host))
      throw new FleetUsageError(
        'Legacy Workstation and canonical Fleet definitions conflict. Review IDs, aliases and network settings before migration.'
      );
    const identity = host['identityFile'];
    if (
      typeof identity !== 'string' ||
      !/^(~\/|\/)[^\x00-\x1f\x7f]+$/.test(identity)
    )
      throw new FleetUsageError('Legacy identity path is invalid.');
    if (result[node.id] !== undefined)
      throw new FleetUsageError('Duplicate legacy machine assignment.');
    result[node.id] = identity;
  }
  return result;
}
export function loadNetworkDefinition(
  workspace: string,
  overrides?: Record<string, string>
): NetworkHost[] {
  const definition = loadDefinition(
    join(workspace, 'packages/fleet/definition.json')
  );
  const legacy: unknown = JSON.parse(
    readFileSync(
      join(workspace, 'packages/fleet/migrations/workstation-network-v1.json'),
      'utf8'
    )
  );
  return networkProjection(
    definition,
    overrides ?? legacyIdentities(definition, legacy)
  );
}
