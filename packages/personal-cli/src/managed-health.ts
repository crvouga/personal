import { verifyT3Linked } from '../../fleet/src/t3-linked-check';
import type { NodeReport, Runner } from '../../fleet/src/types';
import definition from '../../fleet/definition.json';
import { enrolledRoster, parseDefinition } from '../../fleet/src/definition';
import type { Tailnet } from '../../fleet/src/tailscale';
import type { FleetNode } from '../../fleet/src/types';

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
            action: `Enroll ${node.id} with personal fleet add, or use interactive fleet converge enrollment.`,
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
