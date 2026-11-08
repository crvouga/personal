import { verifyT3Linked } from '../../fleet/src/t3-linked-check';
import type { Check, NodeReport, Runner } from '../../fleet/src/types';
import definition from '../../fleet/definition.json';
import { enrolledRoster, parseDefinition } from '../../fleet/src/definition';
import type { Tailnet } from '../../fleet/src/tailscale';
import type { FleetNode } from '../../fleet/src/types';
import {
  verifyBeszel,
  type BeszelRequest,
} from '../../fleet/src/monitoring/beszel';
import { hubAccess } from '../../workstation/cli/lib/monitoring/hub-access';

export interface DashboardAccess {
  (hub: string): Promise<{ request: BeszelRequest }>;
}

/** The hub is the canonical monitoring parent reached by its MagicDNS name. */
export function dashboardUrl(
  tailnet: Tailnet,
  registered: FleetNode[]
): string | null {
  const canonical = parseDefinition(definition);
  const parent = canonical.nodes.find(
    (node) => node.id === canonical.monitoring.parent
  );
  const enrolled = registered.find((node) => node.id === parent?.id);
  const peer = tailnet.computers.find(
    (computer) =>
      (enrolled?.tailscaleId && computer.id === enrolled.tailscaleId) ||
      computer.dns === parent?.network?.tailscaleName
  );
  return peer ? `https://${peer.dns}:8443` : null;
}

/** Centralized dashboard evidence for every canonical worker: the hub must answer
 * privately, and each node must be registered, connected and reporting fresh
 * samples. A missing controller Vault session is reported, never silently passed.
 */
export async function appendDashboardEvidence(
  reports: NodeReport[],
  registered: FleetNode[],
  tailnet: Tailnet,
  options: { access?: DashboardAccess; fetcher?: typeof fetch } = {}
): Promise<string | null> {
  const hub = dashboardUrl(tailnet, registered);
  const dashboard: NodeReport = { node: 'dashboard', checks: [] };
  reports.push(dashboard);
  if (!hub) {
    dashboard.checks.push(
      fail(
        'beszel:hub',
        'BESZEL_HUB_SELECTION_REQUIRED',
        'The canonical monitoring parent is not visible in Tailscale; restore its connection or enroll it with personal fleet-sync.'
      )
    );
    return null;
  }
  dashboard.checks.push(await hubReachable(hub, options.fetcher ?? fetch));
  await nodeEvidence(reports, dashboard, hub, options.access ?? hubAccess);
  return hub;
}

async function nodeEvidence(
  reports: NodeReport[],
  dashboard: NodeReport,
  hub: string,
  access: DashboardAccess
): Promise<void> {
  const canonical = parseDefinition(definition);
  try {
    const { request } = await access(hub);
    for (const machine of canonical.nodes) {
      if (machine.os === 'windows') continue;
      const evidence = await verifyBeszel(hub, machine.id, request);
      const report =
        reports.find(
          (entry) =>
            entry.node === machine.network?.tailscaleName ||
            entry.node === machine.id
        ) ?? dashboard;
      report.checks.push(...evidence.checks);
    }
  } catch (error) {
    dashboard.checks.push({
      id: 'beszel:access',
      status: 'skip',
      summary:
        error instanceof Error && error.message.startsWith('BESZEL_')
          ? error.message
          : 'BESZEL_ACCOUNT_REQUIRED',
      remedy: {
        action:
          'Authenticate this controller to Vault so BESZEL_FLEET_AUTH can be read, then rerun fleet-status --workers. Node registration and metric freshness are unverified until then.',
      },
    });
  }
}

async function hubReachable(
  hub: string,
  fetcher: typeof fetch
): Promise<Check> {
  try {
    const response = await fetcher(`${hub}/api/health`, {
      redirect: 'error',
      signal: AbortSignal.timeout(10_000),
    });
    if (response.ok)
      return {
        id: 'beszel:hub',
        status: 'pass',
        summary: `Dashboard answers privately at ${hub}.`,
      };
  } catch {
    /* Connection details are not evidence; fall through. */
  }
  return fail(
    'beszel:hub',
    'BESZEL_HUB_UNREACHABLE',
    `The private dashboard did not answer at ${hub}/api/health. Run personal fleet-sync for the monitoring parent; the hub is a pinned Compose service behind Tailscale Serve.`
  );
}

function fail(id: string, summary: string, action: string): Check {
  return { id, status: 'fail', summary, remedy: { action } };
}

/** Explicit developer scope; the ordinary health command still audits all peers. */
export function managedHealthScope(
  tailnet: Tailnet,
  roster: FleetNode[],
  includeController = true
) {
  const canonical = parseDefinition(definition);
  const declared = roster.filter((node) =>
    canonical.nodes.some((entry) => entry.id === node.id)
  );
  const nodes = declared.length
    ? enrolledRoster(canonical, { version: 1, nodes: declared }).nodes
    : [];
  const computers = tailnet.computers.filter(
    (peer) =>
      (includeController && peer.self) ||
      canonical.nodes.some(
        (node) =>
          peer.dns === node.network?.tailscaleName ||
          peer.dns.split('.')[0] === node.ssh ||
          nodes.some(
            (entry) => entry.id === node.id && entry.tailscaleId === peer.id
          )
      )
  );
  const missing = canonical.nodes.filter(
    (node) => !nodes.some((entry) => entry.id === node.id)
  );
  return {
    nodes,
    tailnet: {
      ...tailnet,
      computers,
      checks: [
        ...tailnet.checks,
        ...missing.map((node) => ({
          id: `fleet:enrollment:${node.id}`,
          status: 'fail' as const,
          summary:
            'Canonical developer node lacks a verified SSH/check-out registration.',
          remedy: {
            action: `Enroll ${node.id} with personal fleet-node-add, or use interactive fleet-sync enrollment.`,
          },
        })),
      ],
    },
    excluded: tailnet.computers
      .filter((peer) => !computers.includes(peer))
      .map((peer) => peer.dns),
  };
}

export async function appendControllerLinks(
  reports: NodeReport[],
  registered: FleetNode[],
  run: Runner
): Promise<void> {
  for (const node of registered) {
    const machine = definition.nodes.find((entry) => entry.id === node.id);
    const report = reports.find(
      (entry) =>
        entry.node === machine?.network?.tailscaleName || entry.node === node.id
    );
    if (report) report.checks.push(await verifyT3Linked(node, run));
  }
}
