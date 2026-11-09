import { verifyT3Linked } from '../../fleet/src/t3-linked-check';
import { createHash } from 'node:crypto';
import { verifyT3Endpoint } from '../../fleet/src/t3-endpoint';
import { authorizePrivilege } from './fleet-sync-privilege';
import { authorizeVault } from './fleet-sync-vault';
import { managerFailure } from '../../fleet/src/manager-failure';
import { managerText } from './fleet-sync-output';
import { synchronizeMonitoring } from './fleet-sync-monitoring';
import { convergeManager } from './fleet-sync-manager';
import { FleetUsageError } from '../../fleet/src/errors';
import { loadConfig, selectNodes } from '../../fleet/src/config';
import { parseDefinition, enrolledRoster } from '../../fleet/src/definition';
import definition from '../../fleet/definition.json';
import { synchronizeManager } from '../../fleet/src/manager-sync';
import { inspectBootstrap } from '../../fleet/src/manager-sync';
import {
  prepareBootstrap,
  bootstrapRemote,
} from '../../fleet/src/remote-bootstrap';
import { machineRoot } from './fleet-sync';
import type { Runner } from '../../fleet/src/types';
import type { DeployNode } from '../../fleet/src/manager-sync';
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
    const report = managerFailure(
      scoped,
      options.revision,
      'FLEET_PLAN_STALE',
      'Manager connection bindings or target policy changed after approval. Inspect a fresh plan and approve it; no source preparation or node mutation occurred.'
    );
    return { exitCode: 1, data: report, text: managerText(report) };
  }
  const payload = options.apply
    ? await prepareBootstrap(machineRoot(), options.revision, run, {
        definition: canonical,
        checkout: settings.workspace,
      })
    : null;
  const report = await synchronizeManager(
    {
      definition: scoped,
      nodes,
      revision: options.revision,
      apply: Boolean(options.apply),
      // The manager converges first; the first declared worker is the canary.
      ...(canonical.workers[0] ? { canary: canonical.workers[0].id } : {}),
      progress: ui.notify,
      manager: () =>
        convergeManager(
          canonical,
          {
            revision: options.revision!,
            apply: Boolean(options.apply),
            workspace: settings.workspace,
          },
          run
        ),
    },
    run,
    deployWithMonitoring(payload, canonical, run, ui)
  );
  return {
    exitCode: report.ok ? 0 : 1,
    data: { ...report, planFingerprint },
    text: managerText(report),
  };
}

function enrollmentRequired(
  canonical: ReturnType<typeof parseDefinition>,
  revision: string
): CommandOutcome {
  const report = managerFailure(
    canonical,
    revision,
    'FLEET_MANAGER_ENROLLMENT_REQUIRED',
    'Create or migrate private manager connection overrides for the canonical fleet. Resolve conflicting IDs/SSH aliases; discovery cannot authorize membership.'
  );
  return { exitCode: 1, data: report, text: managerText(report) };
}

function deployWithMonitoring(
  payload: Awaited<ReturnType<typeof prepareBootstrap>>,
  canonical: ReturnType<typeof parseDefinition>,
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
                'Install Git on the manager and verify the approved source contains the tracked remote bootstrap and matches this package’s canonical fleet definition. Use the matching package release after a membership change. No manager credentials are forwarded.',
            },
          },
        ],
      };
    if (ui.interactiveAuthorization) {
      const checks = await authorizePrivilege(node, payload.authorizeSudo, run);
      if (checks.length) return { node: node.id, checks };
    }
    const vault = { interactive: ui.interactiveAuthorization };
    const before = await authorizeVault(node, vault, run);
    const result = await withProgress(node.id, ui.progress, () =>
      bootstrapRemote(node, payload, run)
    );
    // A fresh node gets vault from the bootstrap; log it in now. Its provider
    // checks in this run predate the login, so the next sync verifies them.
    result.checks.push(
      ...(before.length ? before : await authorizeVault(node, vault, run))
    );
    // Workers are Linux by definition.
    result.checks.push(...(await inspectBootstrap(node, run, 'linux')));
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
          synchronizeMonitoring(node, canonical, revision, run)
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
        workers: canonical.workers.filter((node) => ids.includes(node.id)),
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
