import type { CommandOutcome } from './contracts';
import {
  callArgs,
  isCancellation,
  record,
  reproduction,
  reportChecks,
} from './ui-data';
import type { Session } from './ui-types';

export async function execute(
  session: Session,
  args: string[],
  title: string
): Promise<CommandOutcome> {
  session.display.write(`\n$ ${reproduction(session, args)}`);
  const progress = session.display.progress(title);
  try {
    return await session.options.execute(callArgs(session, args));
  } catch (error) {
    if (isCancellation(error)) throw error;
    return { exitCode: 1, data: { ok: false, code: 'operation_failed' } };
  } finally {
    progress.stop();
  }
}

export function successful(outcome: CommandOutcome): boolean {
  return (
    outcome.exitCode === 0 &&
    !(record(outcome.data) && outcome.data['ok'] === false)
  );
}

export function showOutcome(session: Session, outcome: CommandOutcome): void {
  const checks = reportChecks(outcome.data);
  const incomplete = checks.filter((check) =>
    ['warn', 'skip'].includes(check.status)
  ).length;
  const state = successful(outcome)
    ? incomplete
      ? 'WARNING'
      : 'SUCCESS'
    : 'FAILED';
  const counts = ['pass', 'warn', 'fail', 'skip'].map(
    (status) =>
      `${checks.filter((check) => check.status === status).length} ${status}`
  );
  session.display.panel(
    state,
    checks.length ? counts.join(' · ') : outcomeMessage(outcome)
  );
  if (!successful(outcome))
    session.display.write(
      'No automatic repair was attempted. Review the command, context and setup.'
    );
}

function outcomeMessage(outcome: CommandOutcome): string {
  if (!successful(outcome)) return failureMessage(outcome.data);
  if (record(outcome.data) && outcome.data['applied'] === false) {
    return 'Preview only — no changes applied. Review before explicitly authorizing a write.';
  }
  return 'Command completed. Warnings and skipped checks are not passes.';
}

function failureMessage(data: unknown): string {
  if (!record(data))
    return 'Operation failed. Raw errors and subprocess output are intentionally hidden.';
  const messages: Record<string, string> = {
    invalid_usage:
      'Configuration or arguments need attention. Use Fleet setup, validate, or session context.',
    config_missing:
      'No roster found. Add a node in Fleet setup, or run controller-only diagnostics.',
    operation_failed:
      'Operation failed safely. Check connectivity and configuration before retrying.',
  };
  return (
    messages[String(data['code'])] ??
    'Operation did not complete. Review setup and the noninteractive command.'
  );
}
