import { localCheckoutRevision } from '../../fleet/src/machine/local-source';
import canonicalDefinition from '../../fleet/definition.json';
import { parseDefinition } from '../../fleet/src/definition';
import { controllerFailure } from '../../fleet/src/controller-failure';
import { controllerText } from './fleet-sync-output';
import { controllerSchedule, type ScheduleAction } from './fleet-sync-schedule';
import { enrollController } from './fleet-sync-enrollment';
import { authorizeController } from './fleet-sync-vault';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  readEnrollment,
  isRevision,
  saveEnrollment,
  withMachineLock,
  ensurePrivateRoot,
} from '../../fleet/src/machine/state';
import { runCommand } from '../../fleet/src/runner';
import type { Runner } from '../../fleet/src/types';
import type { Settings } from './settings';
import type { CommandOutcome } from './contracts';
import { FleetUsageError } from '../../fleet/src/errors';
import { FleetLockError } from '../../fleet/src/machine/lock-error';
import { selected } from './fleet-sync-remote';

declare const PERSONAL_SOURCE_REVISION: string | null;
export interface FleetSyncOptions {
  revision?: string;
  dryRun?: boolean;
  apply?: boolean;
  yes?: boolean;
  json?: boolean;
  nonInteractive?: boolean;
  node?: string[];
  all?: boolean;
  schedule?: ScheduleAction;
  /** Internal: set for interactive terminal runs (sudo enrollment prompts). */
  interactiveAuthorization?: boolean;
  expectedPlanFingerprint?: string;
}
export function machineRoot(): string {
  return join(homedir(), '.local/share/personal/fleet/controller');
}

/** Public contract v2: whole enrolled fleet, controller push only. */
export async function fleetSync(
  options: FleetSyncOptions,
  settings: Settings,
  run: Runner = runCommand
): Promise<CommandOutcome> {
  validate(options);
  if (options.schedule === 'status')
    return controllerSchedule(
      {
        action: 'status',
        revision: '',
        config: settings.config,
        authorized: false,
      },
      run
    );
  const root = machineRoot();
  await ensurePrivateRoot(root);
  const state = await readEnrollment(root);
  const revision = await selectedRevision(
    options.revision,
    state?.approvedRevision,
    settings,
    run
  );
  if (!isRevision(revision))
    return actionRequired(
      'FLEET_REVISION_REQUIRED',
      'Select an approved full SHA with --revision, or use a published package containing clean source provenance.'
    );
  if (options.schedule)
    return scheduleRequest(options, revision, settings, run);
  const request = { ...options, revision };
  if (request.dryRun) return selected(request, settings, run);
  // Applies without a confirmation prompt; --dry-run is the preview.
  request.apply = true;
  request.yes = true;
  if (interactive(options)) {
    await enrollController(settings.config, run);
    // Needed to hand each node its own Vault token; nodes report any gap.
    await authorizeController({ interactive: true }, run);
    request.interactiveAuthorization = true;
  }
  return withMachineLock(root, async () => {
    const approval = {
      ...state,
      version: 1 as const,
      id: 'controller',
      approvedRevision: revision,
    };
    await saveEnrollment(root, approval);
    const result = await selected(request, settings, run);
    if (result.exitCode === 0)
      await saveEnrollment(root, {
        ...approval,
        appliedRevision: revision,
        ...(state?.appliedRevision && state.appliedRevision !== revision
          ? { previousRevision: state.appliedRevision }
          : {}),
      });
    return result;
  }).catch((error: unknown) => {
    if (error instanceof FleetLockError)
      return actionRequired(
        'FLEET_CONTROLLER_LOCKED',
        'Another controller run or interrupted lock exists. Inspect controller and remote processes before removing an abandoned sync.lock; never steal active package-manager locks.'
      );
    throw error;
  });
}
function actionRequired(code: string, remedy: string): CommandOutcome {
  const report = controllerFailure(
    parseDefinition(canonicalDefinition),
    null,
    code,
    remedy
  );
  return { exitCode: 1, data: report, text: controllerText(report) };
}

function validate(options: FleetSyncOptions): void {
  validateSchedule(options.schedule);
  if (options.all && options.node?.length)
    throw new FleetUsageError('Choose --all or --node, not both.');
  if (options.revision !== undefined && !isRevision(options.revision))
    throw new FleetUsageError(
      '--revision requires an exact lowercase 40-character commit SHA.'
    );
  if (options.dryRun && (options.apply || options.yes))
    throw new FleetUsageError(
      '--dry-run cannot be combined with apply confirmation.'
    );
}
function interactive(options: FleetSyncOptions): boolean {
  return (
    ![
      options.dryRun,
      options.apply,
      options.yes,
      options.json,
      options.nonInteractive,
      process.env['CI'],
    ].some(Boolean) && Boolean(process.stdin.isTTY && process.stderr.isTTY)
  );
}

function packageRevision(): string | undefined {
  return typeof PERSONAL_SOURCE_REVISION === 'string'
    ? PERSONAL_SOURCE_REVISION
    : undefined;
}

async function scheduleRequest(
  options: FleetSyncOptions,
  revision: string,
  settings: Settings,
  run: Runner
): Promise<CommandOutcome> {
  const root = machineRoot();

  if (options.dryRun)
    return actionRequired(
      'FLEET_SCHEDULE_PREVIEW',
      'No schedule changed. Inspect --schedule status; scheduling writes require --apply --yes.'
    );
  if (!options.apply || !options.yes)
    return controllerSchedule(
      {
        action: options.schedule!,
        revision,
        config: settings.config,
        authorized: false,
      },
      run
    );
  return withMachineLock(root, () =>
    controllerSchedule(
      {
        action: options.schedule!,
        revision,
        config: settings.config,
        authorized: Boolean(options.apply && options.yes),
      },
      run
    )
  );
}

function validateSchedule(schedule: unknown): void {
  if (
    schedule !== undefined &&
    !['enable', 'pause', 'resume', 'disable', 'status'].includes(
      String(schedule)
    )
  )
    throw new FleetUsageError('Unknown controller schedule action.');
}

async function selectedRevision(
  explicit: string | undefined,
  approved: string | undefined,
  settings: Settings,
  run: Runner
): Promise<string | undefined> {
  return (
    explicit ??
    packageRevision() ??
    (await localCheckoutRevision(settings.workspace, run)) ??
    approved
  );
}
