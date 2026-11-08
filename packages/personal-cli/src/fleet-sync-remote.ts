import { verifyT3Linked } from '../../fleet/src/t3-linked-check';
import { createHash } from 'node:crypto';
import { verifyT3Endpoint } from '../../fleet/src/t3-endpoint';
import { authorizePrivilege } from './fleet-sync-privilege';
import { controllerFailure } from '../../fleet/src/controller-failure';
import { controllerText } from './fleet-sync-output';
import { synchronizeMonitoring } from './fleet-sync-monitoring';
import { FleetUsageError } from '../../fleet/src/errors';
import { loadConfig, selectNodes } from '../../fleet/src/config';
import { parseDefinition, enrolledRoster } from '../../fleet/src/definition';
import definition from '../../fleet/definition.json';
import { synchronizeController } from '../../fleet/src/controller-sync';
import { inspectBootstrap } from '../../fleet/src/controller-sync';
import {
  prepareBootstrap,
  bootstrapRemote,
} from '../../fleet/src/remote-bootstrap';
import { machineRoot } from './fleet-sync';
import type { Runner, FleetNode } from '../../fleet/src/types';
import type { DeployNode } from '../../fleet/src/controller-sync';
import type { FleetSyncOptions } from './fleet-sync';
import type { Settings } from './settings';
import type { CommandOutcome } from './contracts';

export async function selected(
  options: FleetSyncOptions,
  settings: Settings,
  run: Runner
): Promise<CommandOutcome> {
  if (!options.revision)
    throw new FleetUsageError('An approved source revision is required.');
  const canonical = parseDefinition(definition);
  let roster;
  try {
    roster = enrolledRoster(canonical, await loadConfig(settings.config));
  } catch {
    return enrollmentRequired(canonical, options.revision);
  }
  const nodes = selectNodes(roster, options.node ?? []);
  const scoped = scopeDefinition(canonical, options.node);
  const ui = interfaceOptions(options);
  const planFingerprint = createHash('sha256')
    .update(
      JSON.stringify({ revision: options.revision, definition: scoped, nodes })
    )
    .digest('hex');
  if (
    options.expectedPlanFingerprint &&
    options.expectedPlanFingerprint !== planFingerprint
  ) {
    const report = controllerFailure(
      scoped,
      options.revision,
      'FLEET_PLAN_STALE',
      'Controller connection bindings or target policy changed after approval. Inspect a fresh plan and approve it; no source preparation or node mutation occurred.'
    );
    return { exitCode: 1, data: report, text: controllerText(report) };
  }
  const payload = options.apply
    ? await prepareBootstrap(machineRoot(), options.revision, run, {
        definition: canonical,
        checkout: settings.workspace,
      })
    : null;
  const report = await synchronizeController(
    {
      definition: scoped,
      nodes,
      revision: options.revision,
      apply: Boolean(options.apply),
      canary: canonical.proxy.owner,
      progress: ui.notify,
    },
    run,
    deployWithMonitoring(
      payload,
      roster.nodes.find((entry) => entry.id === canonical.monitoring.parent),
      run,
      ui
    )
  );
  return {
    exitCode: report.ok ? 0 : 1,
    data: { ...report, planFingerprint },
    text: controllerText(report),
  };
}

function enrollmentRequired(
  canonical: ReturnType<typeof parseDefinition>,
  revision: string
): CommandOutcome {
  const report = controllerFailure(
    canonical,
    revision,
    'FLEET_CONTROLLER_ENROLLMENT_REQUIRED',
    'Create or migrate private controller connection overrides for the canonical fleet. Resolve conflicting IDs/SSH aliases; discovery cannot authorize membership.'
  );
  return { exitCode: 1, data: report, text: controllerText(report) };
}

function deployWithMonitoring(
  payload: Awaited<ReturnType<typeof prepareBootstrap>>,
  hub: FleetNode | undefined,
  run: Runner,
  ui: { progress: boolean; interactiveAuthorization: boolean }
): DeployNode {
  return async (node, revision) => {
    if (!payload || payload.revision !== revision)
      return {
        node: node.id,
        checks: [
          {
            id: 'source:bootstrap',
            status: 'fail' as const,
            summary: 'FLEET_APPROVED_BOOTSTRAP_UNAVAILABLE',
            remedy: {
              action:
                'Install Git on the controller and verify the approved source contains the tracked remote bootstrap and matches this package’s canonical fleet definition. Use the matching package release after a membership change. No controller credentials are forwarded.',
            },
          },
        ],
      };
    if (ui.interactiveAuthorization) {
      const checks = await authorizePrivilege(node, payload.authorizeSudo, run);
      if (checks.length) return { node: node.id, checks };
    }
    const result = await withProgress(node.id, ui.progress, () =>
      bootstrapRemote(node, payload, run)
    );
    const os =
      parseDefinition(definition).nodes.find((entry) => entry.id === node.id)
        ?.os ?? 'linux';
    result.checks.push(...(await inspectBootstrap(node, run, os)));
    result.checks.push(...(await verifyT3Endpoint(node, run)));
    result.checks.push(await verifyT3Linked(node, run));
    if (
      result.checks.some(
        (check) => check.id === 'configuration:apply' && check.status === 'pass'
      )
    ) {
      result.checks = result.checks.filter(
        (check) => check.id !== 'beszel:freshness'
      );
      result.checks.push(
        ...(await withProgress(node.id, ui.progress, () =>
          synchronizeMonitoring(node, hub, revision, run)
        ))
      );
    }
    return result;
  };
}

async function withProgress<T>(
  node: string,
  enabled: boolean,
  operation: () => Promise<T>
): Promise<T> {
  if (!enabled) return operation();
  process.stderr.write(
    `[${node}] Starting approved remote convergence; the node must acquire its operation lock before installation.\n`
  );
  const timer = setInterval(
    () =>
      process.stderr.write(
        `[${node}] Remote convergence is still running; waiting within its bounded deadline.\n`
      ),
    30_000
  );
  try {
    return await operation();
  } finally {
    clearInterval(timer);
    process.stderr.write(
      `[${node}] Remote operation returned; verifying fresh SSH and monitoring evidence.\n`
    );
  }
}

function scopeDefinition(
  canonical: ReturnType<typeof parseDefinition>,
  ids?: string[]
) {
  return ids?.length
    ? {
        ...canonical,
        nodes: canonical.nodes.filter((node) => ids.includes(node.id)),
      }
    : canonical;
}
function interfaceOptions(options: FleetSyncOptions) {
  return {
    progress: !options.json,
    interactiveAuthorization: Boolean(
      options.interactiveAuthorization &&
      !options.json &&
      !options.nonInteractive
    ),
    notify: (node: string, phase: string) => {
      if (!options.json)
        process.stderr.write('[' + node + '] ' + phase + '.\n');
    },
  };
}
