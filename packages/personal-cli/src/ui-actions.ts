import type { CommandOutcome, CommandSpec } from './contracts';
import { execute, showOutcome, successful } from './ui-execute';
import { clean, reportChecks, reproduction } from './ui-data';
import { inspectChecks, inspectDetails } from './ui-reports';
import { chooseTargets } from './ui-targets';
import type { Choice, Session } from './ui-types';

export async function runCommand(
  session: Session,
  command: CommandSpec
): Promise<void> {
  session.display.panel(clean(command.title), clean(command.description));
  const args = await actionArgs(session, command);
  if (!args) return;
  const preview =
    args[0] === 'fleet' && ['sync', 'init'].includes(args[1] ?? '');
  if (args[1] === 'init')
    session.display.write(
      'EXAMPLE ONLY: init previews a starter roster, not a configured fleet. Saving requires --apply --yes.'
    );
  const mutation = !preview && (command.mutation || args.includes('--apply'));
  if (mutation && !(await confirmMutation(session, args))) return;
  await runWithResults(session, args, command.title, { preview, mutation });
}

async function actionArgs(
  session: Session,
  command: CommandSpec
): Promise<string[] | undefined> {
  const args = [...command.args];
  if (args[0] !== 'fleet') return args;
  if (args.includes('--local')) return args;
  const action = args[1] ?? '';
  if (['sync', 'init'].includes(action)) {
    const preview = args.filter((arg) => !['--apply', '--yes'].includes(arg));
    if (action === 'init') return preview;
    const targets = await chooseTargets(session, action);
    return targets ? [...preview, ...targets] : undefined;
  }
  if (!['doctor', 'onboard'].includes(action)) return args;
  const targets = await chooseTargets(session, action);
  return targets ? [...args, ...targets] : undefined;
}

export async function runWithResults(
  session: Session,
  initialArgs: string[],
  title: string,
  settings: { preview?: boolean; mutation?: boolean } = {}
): Promise<void> {
  let args = initialArgs;
  let outcome = await execute(session, args, title);
  let preview = settings.preview === true;
  let mutation = settings.mutation === true;
  while (true) {
    showOutcome(session, outcome);
    const selection = await session.prompts.select(
      'Next step',
      resultChoices(outcome, preview)
    );
    if (selection === 'back') return;
    await inspectSelection(session, outcome, selection);
    if (selection === 'apply') {
      const appliedArgs = [...args, '--apply', '--yes'];
      if (!(await confirmMutation(session, appliedArgs))) continue;
      args = appliedArgs;
      preview = false;
      mutation = true;
      outcome = await execute(session, args, title);
    }
    if (selection === 'retry') {
      if (mutation && !(await confirmMutation(session, args))) continue;
      outcome = await execute(session, args, title);
    }
  }
}

async function inspectSelection(
  session: Session,
  outcome: CommandOutcome,
  selection: string
): Promise<void> {
  if (selection === 'checks') await inspectChecks(session, outcome.data);
  if (selection === 'details') await inspectDetails(session, outcome.data);
}

function resultChoices(outcome: CommandOutcome, preview: boolean): Choice[] {
  return [
    { name: 'Back to commands', value: 'back' },
    ...(reportChecks(outcome.data).length
      ? [{ name: 'Explore checks and remedies…', value: 'checks' }]
      : []),
    { name: 'Inspect structured details / plan…', value: 'details' },
    ...(preview && successful(outcome)
      ? [{ name: 'Review and explicitly apply…', value: 'apply' }]
      : []),
    ...(!successful(outcome)
      ? [{ name: 'Retry command…', value: 'retry' }]
      : []),
  ];
}

export async function confirmMutation(
  session: Session,
  args: string[]
): Promise<boolean> {
  const action = args[1];
  const warning =
    action === 'sync'
      ? 'Sync runs trusted checkout lifecycle scripts and installs tools/dependencies. Failure can leave partial changes; remote installers may continue after disconnect. Inspect the node before retrying. No automatic repairs or credentials.'
      : 'This writes the local roster only. No cloud resources, SSH configuration, credentials or host keys are changed.';
  session.display.panel(
    'Explicit approval required',
    [
      action === 'init'
        ? 'Create an EXAMPLE roster only. Replace sample aliases and paths before diagnostics.'
        : warning,
      `Workspace: ${clean(session.workspace ?? session.options.workspace)}`,
      `Config: ${clean(session.config ?? session.options.config)}`,
      `$ ${reproduction(session, args)}`,
    ].join('\n')
  );
  return session.prompts.confirm('Apply this exact command? (default: no)');
}
