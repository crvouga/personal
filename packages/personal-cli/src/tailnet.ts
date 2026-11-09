import { workerHealthText } from './worker-health-output';
import { fleetReference } from './fleet-reference';
import {
  managedHealthScope,
  appendManagerLinks,
  appendDashboardEvidence,
} from './managed-health';
import { discoverTailnet } from '../../fleet/src/tailscale';
import { tailnetHealth } from '../../fleet/src/tailnet-health';
import {
  makeReport,
  renderReport,
  reportExitCode,
} from '../../fleet/src/report';
import { readRoster } from './roster';
import { timeout } from './options';
import type { FleetServices } from './fleet';
import type { Settings } from './settings';
import type { CliOptions } from './options';
import type { CommandOutcome } from './contracts';

export async function executeTailnet(
  command: string,
  options: CliOptions,
  settings: Settings,
  services: FleetServices
): Promise<CommandOutcome> {
  const { tailnet, registered, coverage } = await healthContext(
    command,
    options,
    settings,
    services
  );
  if (command === 'discover') {
    const ok = tailnet.checks.every((check) => check.status === 'pass');
    return {
      exitCode: ok ? 0 : 1,
      data: {
        version: 1,
        command,
        ok,
        coverage,
        computers: tailnet.computers,
        checks: tailnet.checks,
      },
    };
  }
  const nodes = await tailnetHealth(
    tailnet,
    registered,
    {
      ...(options.workers ? { reference: fleetReference() } : {}),
      includeManagerReport: options.workers !== true,
      root: settings.workspace,
      timeoutMs: timeout({ ...options, timeout: options.timeout ?? '300000' }),
      source: services.source,
    },
    services.run
  );
  if (options.managed)
    await appendManagerLinks(nodes, registered, services.run);
  const dashboard = options.workers
    ? await appendDashboardEvidence(nodes, tailnet)
    : null;
  const report = makeReport('health', nodes);
  const exitCode = reportExitCode(report, true);
  const verified = exitCode === 0;
  return {
    exitCode,
    data: {
      ...report,
      ok: verified,
      ...(options.workers ? { dashboardUrl: dashboard } : {}),
      coverage: {
        ...coverage,
        verified,
        inspected: nodes.filter((node) => node.snapshot).length,
      },
    },
    text: options.workers
      ? workerHealthText({ ...report, ok: verified }, coverage, dashboard)
      : `${renderReport({ ...report, ok: verified })}\nCoverage: ${coverage.computers} visible computers; ${coverage.excludedMobile} mobile devices excluded.\n${coverage.limitation}`,
  };
}

async function healthContext(
  command: string,
  options: CliOptions,
  settings: Settings,
  services: FleetServices
) {
  const discovered = await discoverTailnet(services.run);
  const roster =
    command === 'health' ? await readRoster(settings.config) : null;
  const registered = roster === null ? [] : roster.nodes;
  const managed = options.managed
    ? managedHealthScope(discovered, registered, options.workers !== true)
    : null;
  const tailnet = managed === null ? discovered : managed.tailnet;
  const coverage = {
    scope: options.workers
      ? 'canonical-workers'
      : options.managed
        ? 'canonical-fleet-and-manager'
        : 'tailscale-visible-computers',
    excludedUnmanaged: managed === null ? [] : managed.excluded,
    computers: tailnet.computers.length,
    excludedMobile: tailnet.excludedMobile,
    limitation:
      'This manager can inspect only devices visible to its Tailscale account/ACLs. Other tailnets, hidden devices and all-pairs connectivity are not verified.',
  };
  return {
    tailnet,
    registered: managed === null ? registered : managed.nodes,
    coverage,
  };
}
