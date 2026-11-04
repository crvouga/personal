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
  const tailnet = await discoverTailnet(services.run);
  const coverage = {
    scope: 'tailscale-visible-computers',
    computers: tailnet.computers.length,
    excludedMobile: tailnet.excludedMobile,
    limitation:
      'This controller can inspect only devices visible to its Tailscale account/ACLs. Other tailnets, hidden devices and all-pairs connectivity are not verified.',
  };
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
  const roster = await readRoster(settings.config);
  const nodes = await tailnetHealth(
    tailnet,
    roster?.nodes ?? [],
    {
      root: settings.workspace,
      timeoutMs: timeout({ ...options, timeout: options.timeout ?? '300000' }),
      source: services.source,
    },
    services.run
  );
  const report = makeReport('health', nodes);
  const exitCode = reportExitCode(report, true);
  const verified = exitCode === 0;
  return {
    exitCode,
    data: {
      ...report,
      ok: verified,
      coverage: {
        ...coverage,
        verified,
        inspected: nodes.filter((node) => node.snapshot).length,
      },
    },
    text: `${renderReport({ ...report, ok: verified })}\nCoverage: ${coverage.computers} visible computers; ${coverage.excludedMobile} mobile devices excluded.\n${coverage.limitation}`,
  };
}
