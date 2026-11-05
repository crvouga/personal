import { configureWorkspace, validConfiguration } from './configure';
import { readFile, writeFile } from 'node:fs/promises';
import { loadConfig, selectNodes } from './config';
import { doctor } from './controller';
import { onboarding } from './onboard';
import { makeReport, mapBounded, renderReport, reportExitCode } from './report';
import { syncPlan, syncWorkspace } from './sync';
import { bundleProbe, inspectRemote } from './transport';
import { runCommand } from './runner';
import { HELP } from './help';
import { FleetUsageError } from './errors';
import { fileURLToPath } from 'node:url';
import { record } from './config';
import type { Options } from './cli-options';
import type { FleetNode, NodeReport } from './types';

export function print(value: unknown, text?: string): void {
  process.stdout.write(`${text ?? JSON.stringify(value, null, 2)}\n`);
}

export async function dispatch(options: Options): Promise<number> {
  if (['help', 'schema', 'init'].includes(options.command))
    return setupCommand(options);
  const nodes = options.local
    ? []
    : selectNodes(await loadConfig(options.config), options.ids);
  if (['nodes', 'validate', 'onboard'].includes(options.command)) {
    const data =
      options.command === 'onboard'
        ? nodes.map((node) => onboarding(node))
        : nodes;
    print({ version: 1, command: options.command, ok: true, nodes: data });
    return 0;
  }
  if (options.command === 'configure') return configureCommand(nodes, options);
  if (options.command === 'sync' && !options.apply) {
    print({
      version: 1,
      command: 'sync',
      applied: false,
      targets: options.local ? ['local'] : nodes.map((node) => node.id),
      steps: syncPlan(options.pull),
      authorize: 'Repeat with --apply --yes only after reviewing the plan.',
    });
    return 0;
  }
  return runReport(nodes, options);
}

async function setupCommand(options: Options): Promise<number> {
  if (options.command === 'help') {
    print({ version: 1, help: HELP }, options.json ? undefined : HELP);
    return 0;
  }
  if (options.command === 'schema') {
    print(
      JSON.parse(
        await readFile(new URL('../schema.json', import.meta.url), 'utf8')
      )
    );
    return 0;
  }
  return initialize(options);
}

async function runReport(
  nodes: FleetNode[],
  options: Options
): Promise<number> {
  const reports =
    options.command === 'doctor'
      ? await doctor(nodes, options, runCommand)
      : await applySync(nodes, options);
  const report = makeReport(options.command, reports);
  print(report, options.json ? undefined : renderReport(report));
  return reportExitCode(report, options.strict);
}

async function initialize(options: Options): Promise<number> {
  const config: unknown = JSON.parse(
    await readFile(new URL('../fleet.example.json', import.meta.url), 'utf8')
  );
  if (record(config))
    config['$schema'] = fileURLToPath(
      new URL('../schema.json', import.meta.url)
    );
  if (options.apply) {
    try {
      await writeFile(options.config, JSON.stringify(config, null, 2) + '\n', {
        flag: 'wx',
        mode: 0o600,
      });
    } catch {
      throw new FleetUsageError(
        'Cannot create roster; existing files are never overwritten. Choose --config PATH.'
      );
    }
  }
  print({
    version: 1,
    command: 'init',
    applied: options.apply,
    path: options.config,
    config,
    next: 'Edit aliases/absolute paths and required capabilities, then run fleet validate and fleet onboard.',
  });
  return 0;
}

async function applySync(
  nodes: FleetNode[],
  options: Options
): Promise<NodeReport[]> {
  if (options.local)
    return [
      {
        node: 'local',
        checks: await syncWorkspace(options.root, options.pull, runCommand),
      },
    ];
  const source = await bundleProbe();
  return mapBounded(
    nodes,
    (node) =>
      inspectRemote(
        node,
        {
          source,
          timeoutMs: options.timeoutMs,
          action: 'sync',
          pull: options.pull,
        },
        runCommand
      ),
    1
  );
}

async function configureCommand(
  nodes: FleetNode[],
  options: Options
): Promise<number> {
  const targets = options.local ? [{ id: 'local' }] : nodes;
  const selection = {
    revision: options.revision,
    tool: options.tool,
    profile: options.profile,
  };
  if (!validConfiguration({ ...selection, node: targets[0]?.id ?? 'local' }))
    throw new FleetUsageError(
      'configure requires --revision FULL_COMMIT_SHA and a supported --tool/--profile.'
    );
  if (!options.apply) {
    print({
      version: 1,
      applied: false,
      targets: targets.map((node) => node.id),
      ...selection,
      steps: [
        'Use a clean pinned Git deployment worktree; preserve developer checkout.',
        'Delegate setup to mise/bootstrap, configuration to ws.',
        'Advance per-node receipt only after success. Test canary before selecting more nodes.',
      ],
      authorize:
        'Repeat with --apply --yes. Revision must already exist on each node.',
    });
    return 0;
  }
  const source = options.local ? '' : await bundleProbe();
  const reports: NodeReport[] = [];
  for (const node of targets) {
    const configuration = { ...selection, node: node.id };
    reports.push(
      options.local
        ? {
            node: node.id,
            checks: await configureWorkspace(
              options.root,
              configuration,
              runCommand
            ),
          }
        : await inspectRemote(
            node as FleetNode,
            {
              source,
              timeoutMs: options.timeoutMs,
              action: 'configure',
              configuration,
            },
            runCommand
          )
    );
  }
  const report = makeReport('configure', reports);
  print(report, options.json ? undefined : renderReport(report));
  return reportExitCode(report, options.strict);
}
