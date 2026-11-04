import { writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { selectNodes } from '../../fleet/src/config';
import { doctor } from '../../fleet/src/controller';
import { FleetUsageError } from '../../fleet/src/errors';
import { onboarding } from '../../fleet/src/onboard';
import {
  makeReport,
  mapBounded,
  renderReport,
  reportExitCode,
} from '../../fleet/src/report';
import { syncPlan, syncWorkspace } from '../../fleet/src/sync';
import { inspectRemote } from '../../fleet/src/transport';
import { runCommand } from '../../fleet/src/runner';
import schema from '../../fleet/schema.json';
import example from '../../fleet/fleet.example.json';
import type {
  FleetConfig,
  FleetNode,
  NodeReport,
  Runner,
} from '../../fleet/src/types';
import type { CommandOutcome } from './contracts';
import type { Settings } from './settings';
import { capabilities, timeout, validateOptions } from './options';
import type { CliOptions } from './options';
import { addNode, nodeFromOptions, readRoster } from './roster';
import { executeTailnet } from './tailnet';
import { probeSource } from './probe-source';

export interface FleetServices {
  run: Runner;
  source: () => Promise<string>;
}

const SERVICES: FleetServices = { run: runCommand, source: probeSource };

export async function executeFleet(
  command: string,
  options: CliOptions,
  settings: Settings,
  services: FleetServices = SERVICES
): Promise<CommandOutcome> {
  validateOptions(command, options);
  if (['discover', 'health'].includes(command))
    return executeTailnet(command, options, settings, services);
  if (command === 'schema') return result(schema);
  if (command === 'init') return initialize(settings, options);
  if (command === 'add') return register(settings, options);
  const roster = options.local ? null : await readRoster(settings.config);
  const nodes = resolveNodes(command, options, roster);
  if (['nodes', 'validate', 'onboard'].includes(command))
    return rosterResult(command, nodes, roster !== null);
  if (command === 'sync')
    return synchronize(nodes, options, settings, services);
  return diagnose(
    nodes,
    options,
    { ...settings, missingRoster: !roster },
    services
  );
}

function rosterResult(
  command: string,
  nodes: FleetNode[],
  configured: boolean
): CommandOutcome {
  return result({
    version: 1,
    command,
    ok: true,
    ...(command === 'nodes' ? { configured } : {}),
    nodes:
      command === 'onboard'
        ? nodes.map((node) => onboarding(node, 'personal fleet'))
        : nodes,
  });
}

function resolveNodes(
  command: string,
  options: CliOptions,
  roster: FleetConfig | null
): FleetNode[] {
  if (!roster && !options.local && !['doctor', 'nodes'].includes(command))
    throw new FleetUsageError(
      'No fleet roster. Use fleet add or the interactive Register action; use fleet doctor --local for this machine.'
    );
  if (options.node?.length && !roster)
    throw new FleetUsageError(
      'Cannot select nodes without a roster. Use fleet add first.'
    );
  return roster ? selectNodes(roster, options.node ?? []) : [];
}

function result(data: unknown, text?: string): CommandOutcome {
  return { exitCode: 0, data, ...(text ? { text } : {}) };
}

async function register(
  settings: Settings,
  options: CliOptions
): Promise<CommandOutcome> {
  const node = nodeFromOptions(options);
  const config = await addNode(settings.config, node, options.apply === true);
  return result({
    version: 1,
    command: 'add',
    ok: true,
    applied: options.apply === true,
    path: settings.config,
    node,
    nodes: config.nodes,
    next: options.apply
      ? 'Run fleet onboard, then fleet doctor --all --json.'
      : 'Review this preview, then repeat with --apply --yes.',
  });
}

async function initialize(
  settings: Settings,
  options: CliOptions
): Promise<CommandOutcome> {
  const config = {
    ...example,
    $schema: new URL('./schema.json', import.meta.url).href,
  };
  if (options.apply) {
    await mkdir(dirname(settings.config), { recursive: true, mode: 0o700 });
    try {
      await writeFile(settings.config, `${JSON.stringify(config, null, 2)}\n`, {
        flag: 'wx',
        mode: 0o600,
      });
    } catch {
      throw new FleetUsageError(
        'Cannot create roster. Existing files are never overwritten; use --config PATH.'
      );
    }
  }
  return result({
    version: 1,
    command: 'init',
    ok: true,
    applied: options.apply === true,
    path: settings.config,
    config,
    next: 'This is example data, not discovered machines. Edit placeholders before doctor, or use fleet add to register real nodes.',
  });
}

async function diagnose(
  nodes: FleetNode[],
  options: CliOptions,
  settings: Settings & { missingRoster: boolean },
  services: FleetServices
): Promise<CommandOutcome> {
  const source = nodes.length ? await services.source() : undefined;
  const reports = await doctor(
    nodes,
    {
      root: settings.workspace,
      local: options.local === true,
      required: capabilities(options.require),
      timeoutMs: timeout(options),
      ...(source ? { source } : {}),
    },
    services.run
  );
  if (!options.local && settings.missingRoster) reports.push(missingRoster());
  const report = {
    ...makeReport('doctor', reports),
    coverage: {
      scope: options.local
        ? 'local'
        : options.node?.length
          ? 'selected'
          : 'all-configured',
      controller: true,
      configuredNodesTested: nodes.map((node) => node.id),
      rosterAvailable: !settings.missingRoster,
      note: 'Directed SSH checks from this controller only. T3 relay/peer and VS Code forwarding require operator tests.',
    },
  };
  return {
    exitCode: reportExitCode(report, options.strict === true),
    data: report,
    text: renderReport(report),
  };
}

function missingRoster(): NodeReport {
  return {
    node: 'fleet',
    checks: [
      {
        id: 'fleet:roster',
        status: 'fail',
        summary:
          'No developer fleet roster is configured. Only this controller could be checked; fleet-wide health is unknown.',
        remedy: {
          action:
            'Open personal and choose Register a developer computer, or run personal fleet add --help. Then run fleet doctor --all.',
        },
      },
    ],
  };
}

async function synchronize(
  nodes: FleetNode[],
  options: CliOptions,
  settings: Settings,
  services: FleetServices
): Promise<CommandOutcome> {
  if (!options.apply)
    return result({
      version: 1,
      command: 'sync',
      ok: true,
      applied: false,
      targets: options.local ? ['local'] : nodes.map((node) => node.id),
      steps: syncPlan(options.pull === true),
      authorize:
        'Review the plan; repeat with --apply --yes to authorize changes.',
    });
  const reports = options.local
    ? [
        {
          node: 'local',
          checks: await syncWorkspace(
            settings.workspace,
            options.pull === true,
            services.run
          ),
        },
      ]
    : await syncRemotes(nodes, options, services);
  const report = makeReport('sync', reports);
  return {
    exitCode: reportExitCode(report, options.strict === true),
    data: report,
    text: renderReport(report),
  };
}

async function syncRemotes(
  nodes: FleetNode[],
  options: CliOptions,
  services: FleetServices
): Promise<NodeReport[]> {
  const source = await services.source();
  return mapBounded(
    nodes,
    (node) =>
      inspectRemote(
        node,
        {
          source,
          action: 'sync',
          timeoutMs: timeout(options),
          pull: options.pull === true,
        },
        services.run
      ),
    1
  );
}
