import { selectNodes } from '../../fleet/src/config';
import { probe } from '../../fleet/src/probe';
import { mapBounded } from '../../fleet/src/report';
import { discoverTailnet } from '../../fleet/src/tailscale';
import {
  HEALTH_CAPABILITIES,
  tailnetHealth,
  uniqueMapping,
} from '../../fleet/src/tailnet-health';
import { matchComputers } from '../../fleet/src/tailnet-matching';
import { inspectRemote } from '../../fleet/src/transport';
import { FleetUsageError } from '../../fleet/src/errors';
import { readRoster } from './roster';
import { timeout } from './options';
import type { NodeReport, FleetConfig } from '../../fleet/src/types';
import type { RepairTarget } from '../../fleet/src/repair-plan';
import type { FleetServices } from './fleet';
import type { CliOptions } from './options';
import type { Settings } from './settings';

export interface RepairInspection {
  reports: NodeReport[];
  targets: RepairTarget[];
  coverage: { scope: string; limitation: string };
}
export async function inspectRepair(
  options: CliOptions,
  settings: Settings,
  services: FleetServices
): Promise<RepairInspection> {
  if (options.local) return inspectLocal(settings, services);
  const roster = await readRoster(settings.config);
  if (options.node?.length) return inspectSelected(options, roster, services);
  return inspectTailnet(options, settings, roster, services);
}

async function inspectLocal(
  settings: Settings,
  services: FleetServices
): Promise<RepairInspection> {
  const snapshot = await probe(
    settings.workspace,
    HEALTH_CAPABILITIES,
    services.run
  );
  return {
    reports: [{ node: 'local', snapshot, checks: snapshot.checks }],
    targets: [
      {
        name: 'local',
        root: settings.workspace,
        fingerprint: snapshot.fingerprint,
      },
    ],
    coverage: {
      scope: 'local',
      limitation: 'Only this process context was tested.',
    },
  };
}

async function inspectSelected(
  options: CliOptions,
  roster: FleetConfig | null,
  services: FleetServices
): Promise<RepairInspection> {
  if (!roster)
    throw new FleetUsageError(
      'Register real SSH aliases and checkout paths before selecting remote repairs.'
    );
  const nodes = selectNodes(roster, options.node ?? []);
  const source = await services.source();
  const reports = await mapBounded(nodes, (node) =>
    inspectRemote(
      {
        ...node,
        required: [...new Set([...node.required, ...HEALTH_CAPABILITIES])],
      },
      { action: 'probe', source, timeoutMs: timeout(options) },
      services.run
    )
  );
  return {
    reports,
    targets: nodes.map((node) =>
      attachFingerprint({ name: node.id, root: node.workspace, node }, reports)
    ),
    coverage: {
      scope: 'selected',
      limitation:
        'Only selected roster computers were tested; other devices are unverified.',
    },
  };
}

async function inspectTailnet(
  options: CliOptions,
  settings: Settings,
  roster: FleetConfig | null,
  services: FleetServices
): Promise<RepairInspection> {
  const tailnet = await discoverTailnet(services.run);
  const reports = await tailnetHealth(
    tailnet,
    roster?.nodes ?? [],
    {
      root: settings.workspace,
      timeoutMs: timeout(options),
      source: services.source,
    },
    services.run
  );
  const matches = await matchComputers(
    roster?.nodes ?? [],
    tailnet.computers,
    services.run
  );
  const targets: RepairTarget[] = [];
  for (const peer of tailnet.computers) {
    if (peer.self) targets.push({ name: peer.dns, root: settings.workspace });
    else if (peer.online && uniqueMapping(matches.get(peer.id)!, matches)) {
      const node = matches.get(peer.id)![0]!;
      targets.push({ name: peer.dns, root: node.workspace, node });
    }
  }
  if (!tailnet.computers.some((peer) => peer.self))
    targets.push({ name: 'controller', root: settings.workspace });
  return {
    reports,
    targets: targets.map((target) => attachFingerprint(target, reports)),
    coverage: {
      scope: 'tailscale-visible-computers',
      limitation:
        'Only devices visible to this Tailscale account/ACLs. Offline, unregistered or ambiguous computers cannot be repaired. No credentials, host keys or resources are cloned.',
    },
  };
}

function attachFingerprint(
  target: RepairTarget,
  reports: NodeReport[]
): RepairTarget {
  const snapshot = reports.find(
    (report) => report.node === target.name
  )?.snapshot;
  return {
    ...target,
    ...(snapshot ? { fingerprint: snapshot.fingerprint } : {}),
  };
}
