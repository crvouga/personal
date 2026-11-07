import { record } from '../../fleet/src/config';
import canonicalDefinition from '../../fleet/definition.json';
import { parseDefinition } from '../../fleet/src/definition';
import { controllerFailure } from '../../fleet/src/controller-failure';
import { controllerText } from './fleet-sync-output';
import { controllerSchedule, type ScheduleAction } from './fleet-sync-schedule';
import { enrollController } from './fleet-sync-enrollment';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { confirm } from '@inquirer/prompts';
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
  /** Internal: set only after the interactive consolidated approval. */
  interactiveAuthorization?: boolean;
  expectedPlanFingerprint?: string;
}
export function machineRoot(): string {
  return join(homedir(), '.local/share/personal/fleet/controller');
}

/** Public contract v2: whole enrolled fleet, controller push only.
 * Legacy `fleet sync` retains its original plan-only contract.
 */
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
  const revision = selectedRevision(options.revision, state?.approvedRevision);
  if (!isRevision(revision))
    return actionRequired(
      'FLEET_REVISION_REQUIRED',
      'Select an approved full SHA with --revision, or use a published package containing clean source provenance.'
    );
  if (options.schedule)
    return scheduleRequest(options, revision, settings, run);
  const request = { ...options, revision };
  if (mayPrompt(options)) await approve(request, settings, run);
  if (!request.apply) {
    const result = await selected(request, settings, run);
    if (request.dryRun) return result;
    return {
      ...result,
      exitCode: 1,
      data: {
        ...(result.data as object),
        ok: false,
        actionRequired:
          'FLEET_APPLY_CONFIRMATION_REQUIRED: rerun interactively or with --apply --yes.',
      },
    };
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
  if (Boolean(options.apply) !== Boolean(options.yes))
    throw new FleetUsageError(
      'Unattended changes require both --apply and --yes.'
    );
}
function mayPrompt(options: FleetSyncOptions): boolean {
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

async function approve(
  request: FleetSyncOptions & { revision: string },
  settings: Settings,
  run: Runner
): Promise<void> {
  const revision = request.revision;

  await enrollController(settings.config, run);
  process.stderr.write(
    `Controller fleet synchronization\nApproved source: ${revision}\nScope: every enrolled Ubuntu node, over verified SSH. Effects: managed tooling, services, power policy, designated-user passwordless sudo, shared provider clients and monitoring. This user and its agents will be able to administer the node. Controller source preparation and remote changes require approval.\n`
  );
  const plan = await selected(
    { ...request, apply: false, yes: false, dryRun: true },
    settings,
    run
  );
  process.stderr.write(`${plan.text ?? JSON.stringify(plan.data)}\n`);
  if (!record(plan.data) || typeof plan.data['planFingerprint'] !== 'string')
    return;
  if (
    await confirm({
      message: 'Apply this revision to the enrolled fleet?',
      default: false,
    })
  ) {
    request.apply = true;
    request.yes = true;
    request.interactiveAuthorization = true;
    request.expectedPlanFingerprint = plan.data['planFingerprint'];
  }
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

function selectedRevision(
  explicit: string | undefined,
  approved: string | undefined
): string | undefined {
  return explicit ?? approved ?? packageRevision();
}
