import { deployment } from '../node-deployment';
import type { CommandOutcome } from '../contracts';
import type { Settings } from '../settings';
import { FleetUsageError } from '../../../fleet/src/errors';
import { desired, nodeId, paths, type T3Options } from './desired';
import { importT3, reconcileT3 } from './reconcile';

export async function t3Command(
  command: string,
  options: T3Options,
  settings: Settings
): Promise<CommandOutcome> {
  const deployed = options.definition
    ? null
    : await deployment(settings.workspace);
  const workspace = deployed?.workspace ?? settings.workspace;
  const target = paths(options, workspace);
  if (command === 't3-import') return importCommand(target, options);
  const instances =
    command === 't3-cleanup'
      ? {}
      : await desired(
          target.definition,
          workspace,
          nodeId(options.id ?? deployed?.node)
        );
  const apply = shouldApply(command, options);
  if (apply) requireSupportedPlatform(instances);
  const data = await reconcileT3(target, instances, {
    apply,
    ...(options.planHash ? { planHash: options.planHash } : {}),
  });
  return {
    exitCode: outcomeCode(command, data),
    data: { command, ...data },
  };
}

async function importCommand(
  target: ReturnType<typeof paths>,
  options: T3Options
): Promise<CommandOutcome> {
  if (options.dryRun)
    throw new FleetUsageError(
      't3-import is an explicit ownership operation; inspect t3-plan first.'
    );
  if (
    !options.instance ||
    !/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(options.instance)
  )
    throw new FleetUsageError(
      't3-import requires --instance ID. Import authorizes management of that entire provider instance.'
    );
  return { exitCode: 0, data: await importT3(target, options.instance) };
}

function shouldApply(command: string, options: T3Options): boolean {
  return ['t3-apply', 't3-cleanup'].includes(command) && !options.dryRun;
}
function outcomeCode(
  command: string,
  data: { ok: boolean; changed: boolean }
): number {
  return !data.ok || (command === 't3-status' && data.changed) ? 1 : 0;
}

function requireSupportedPlatform(instances: Record<string, unknown>): void {
  if (process.platform === 'win32' && Object.keys(instances).length)
    throw new FleetUsageError(
      'Managed Codex proxy execution requires macOS/Linux/WSL; native Windows settings were preserved.'
    );
}
