import type { FleetNode, Runner, Check } from '../../fleet/src/types';
import { discoverTailnet } from '../../fleet/src/tailscale';
import {
  BESZEL_FLEET_IDENTITY,
  hubAccess,
} from '../../workstation/cli/lib/monitoring/hub-access';
import { enrollBeszel } from '../../fleet/src/monitoring/enroll';
import { verifyBeszel } from '../../fleet/src/monitoring/beszel';
import { installRemoteAgent } from '../../fleet/src/monitoring/remote';

/** Called after source bootstrap, only under approved controller application. */
export async function synchronizeMonitoring(
  node: FleetNode,
  hub: FleetNode | undefined,
  revision: string,
  run: Runner
): Promise<Check[]> {
  try {
    const tailnet = await discoverTailnet(run);
    const parent = tailnet.computers.find(
      (peer) => peer.id === hub?.tailscaleId
    );
    const target = tailnet.computers.find(
      (peer) => peer.id === node.tailscaleId
    );
    if (!parent || !target) return unavailable('BESZEL_HUB_SELECTION_REQUIRED');
    const hubUrl = `https://${parent.dns}:8443`;
    const hubChecks =
      node.id === hub?.id
        ? await installRemoteAgent(node, revision, { mode: 'hub', hubUrl }, run)
        : [];
    if (hubChecks.some((check) => check.status !== 'pass')) return hubChecks;
    const access = await hubAccess(hubUrl);
    const enrollment = await enrollBeszel(
      { node: node.id, host: target.dns, hub: hubUrl, userId: access.userId },
      access.request
    );
    const checks = await installRemoteAgent(node, revision, enrollment, run);
    const evidence = await waitForSample(hubUrl, node.id, access.request);
    return [...hubChecks, ...checks, ...evidence.checks];
  } catch (error) {
    const code =
      error instanceof Error &&
      [
        'BESZEL_ACCOUNT_REQUIRED',
        'BESZEL_ACCOUNT_INVALID',
        'BESZEL_AUTH_REQUIRED',
        'BESZEL_API_UNAVAILABLE',
      ].includes(error.message)
        ? error.message
        : 'BESZEL_ENROLLMENT_INCOMPLETE';
    return unavailable(code);
  }
}
function unavailable(code: string): Check[] {
  return [
    {
      id: 'beszel:enrollment',
      status: 'fail',
      summary: code,
      remedy: {
        action:
          code === 'BESZEL_ACCOUNT_REQUIRED'
            ? `The hub rejected the fleet login. Once, as the hub superuser, create the normal users record ${BESZEL_FLEET_IDENTITY} (verified) whose password is the BESZEL_FLEET_AUTH Vault value, then rerun fleet-sync. Never paste the password on a command line.`
            : 'Verify the selected private hub is running and the controller has BESZEL_FLEET_AUTH through existing Vault authorization. The normal hub account must access these systems. Inspect duplicate registration/host conflicts before retry; no token or raw response is printed.',
      },
    },
  ];
}

async function waitForSample(
  hub: string,
  node: string,
  request: Parameters<typeof verifyBeszel>[2]
) {
  const deadline = Date.now() + 90_000;
  let evidence = await verifyBeszel(hub, node, request);
  while (
    Date.now() < deadline &&
    evidence.checks.some((check) => check.summary === 'BESZEL_METRICS_STALE')
  ) {
    await new Promise((resolve) => setTimeout(resolve, 10_000));
    evidence = await verifyBeszel(hub, node, request);
  }
  return evidence;
}
