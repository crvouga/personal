import type { FleetNode, Runner, Check } from '../../fleet/src/types';
import type { FleetDefinition } from '../../fleet/src/definition';
import { hubUrl, roleOf } from '../../fleet/src/topology';
import { discoverTailnet } from '../../fleet/src/tailscale';
import {
  BESZEL_FLEET_IDENTITY,
  hubAccess,
} from '../../workstation/cli/lib/monitoring/hub-access';
import { enrollBeszel } from '../../fleet/src/monitoring/enroll';
import { verifyBeszel } from '../../fleet/src/monitoring/beszel';
import { installRemoteAgent } from '../../fleet/src/monitoring/remote';

export interface MonitoringDependencies {
  access?: typeof hubAccess;
  sampleDeadlineMs?: number;
}

/** Enrolls one worker's Beszel agent against the manager's hub. Workers never
 * host the hub; it is converged on the manager by convergeManagerHub. Called
 * after source bootstrap, only under approved manager application.
 */
export function synchronizeMonitoringWith(
  dependencies: MonitoringDependencies = {}
) {
  return async function synchronize(
    node: FleetNode,
    definition: FleetDefinition,
    revision: string,
    run: Runner
  ): Promise<Check[]> {
    try {
      return await enrollWorker(node, definition, {
        revision,
        run,
        ...dependencies,
      });
    } catch (error) {
      return unavailable(errorCode(error));
    }
  };
}
export const synchronizeMonitoring = synchronizeMonitoringWith();

async function enrollWorker(
  node: FleetNode,
  definition: FleetDefinition,
  context: MonitoringDependencies & { revision: string; run: Runner }
): Promise<Check[]> {
  const { revision, run } = context;
  if (roleOf(definition, node.id) !== 'worker')
    return unavailable('BESZEL_NOT_ENROLLED');
  const hub = hubUrl(definition);
  if (!(await hubReachable(hub, run)))
    return unavailable('BESZEL_HUB_UNREACHABLE');
  const tailnet = await discoverTailnet(run);
  const target = tailnet.computers.find((peer) => peer.id === node.tailscaleId);
  if (!target) return unavailable('BESZEL_NODE_TAILNET_REQUIRED');
  const access = await (context.access ?? hubAccess)(hub);
  const enrollment = await enrollBeszel(
    { node: node.id, host: target.dns, hub, userId: access.userId },
    access.request
  );
  const checks = await installRemoteAgent(node, revision, enrollment, run);
  if (checks.some((check) => check.status === 'fail')) return checks;
  const evidence = await waitForSample(
    hub,
    node.id,
    access.request,
    context.sampleDeadlineMs ?? 90_000
  );
  return [...checks, ...evidence.checks];
}

const PASSTHROUGH = [
  'BESZEL_ACCOUNT_REQUIRED',
  'BESZEL_ACCOUNT_INVALID',
  'BESZEL_AUTH_REQUIRED',
  'BESZEL_API_UNAVAILABLE',
];
function errorCode(error: unknown): string {
  return error instanceof Error && PASSTHROUGH.includes(error.message)
    ? error.message
    : 'BESZEL_ENROLLMENT_INCOMPLETE';
}

async function hubReachable(hub: string, run: Runner): Promise<boolean> {
  const probe = await run(
    [
      'curl',
      '-fsS',
      '--max-time',
      '10',
      '-o',
      '/dev/null',
      `${hub}/api/health`,
    ],
    { timeoutMs: 15_000 }
  );
  return probe.ok;
}

const REMEDIES: Record<string, string> = {
  BESZEL_ACCOUNT_REQUIRED: `The hub rejected the fleet login. Once, as the hub superuser, create the normal users record ${BESZEL_FLEET_IDENTITY} (verified) whose password is the BESZEL_FLEET_AUTH Vault value, then rerun fleet-sync. Never paste the password on a command line.`,
  BESZEL_HUB_UNREACHABLE:
    'The hub runs on the manager; keep it awake and Docker Desktop running, then rerun fleet-sync from the manager so it converges the hub first.',
  BESZEL_NODE_TAILNET_REQUIRED:
    'The worker is not visible on the tailnet. Sign it in to Tailscale and record its tailscaleId in the local roster, then rerun fleet-sync.',
  BESZEL_NOT_ENROLLED:
    'Only workers declared in packages/fleet/definition.json run the agent through fleet-sync; the manager hosts the hub.',
};
function unavailable(code: string): Check[] {
  return [
    {
      id: 'beszel:enrollment',
      status: 'fail',
      summary: code,
      remedy: {
        action:
          REMEDIES[code] ??
          "Verify the manager's private hub is running and the manager has BESZEL_FLEET_AUTH through existing Vault authorization. The normal hub account must access these systems. Inspect duplicate registration/host conflicts before retry; no token or raw response is printed.",
      },
    },
  ];
}

async function waitForSample(
  hub: string,
  node: string,
  request: Parameters<typeof verifyBeszel>[2],
  deadlineMs: number
) {
  const deadline = Date.now() + deadlineMs;
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
