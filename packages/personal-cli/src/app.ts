import { resolveSettings } from './settings';
import { COMMANDS } from './registry';
import { execute } from './program';
import { parseArgs } from 'node:util';

declare const PERSONAL_VERSION: string | undefined;

export const VERSION =
  typeof PERSONAL_VERSION === 'undefined' ? '0.1.0-dev' : PERSONAL_VERSION;

export function wantsInteractive(
  args: string[],
  terminal: boolean,
  ci: boolean
): boolean {
  if (args.includes('--json') || args.includes('--non-interactive'))
    return false;
  return (
    terminal && (args.includes('--interactive') || (contextOnly(args) && !ci))
  );
}

function startup(args: string[]) {
  return parseArgs({
    args,
    allowPositionals: true,
    strict: false,
    options: {
      workspace: { type: 'string' },
      config: { type: 'string' },
      interactive: { type: 'boolean' },
      json: { type: 'boolean' },
      'non-interactive': { type: 'boolean' },
    },
  });
}

function contextOnly(args: string[]): boolean {
  const parsed = startup(args);
  return (
    parsed.positionals.length === 0 &&
    Object.keys(parsed.values).every((key) =>
      ['workspace', 'config', 'interactive'].includes(key)
    )
  );
}

export async function main(args = process.argv.slice(2)): Promise<number> {
  const { values } = startup(args);
  const settings = await resolveSettings({
    ...(typeof values.workspace === 'string'
      ? { workspace: values.workspace }
      : {}),
    ...(typeof values.config === 'string' ? { config: values.config } : {}),
  });
  const terminal =
    process.stdin.isTTY === true && process.stderr.isTTY === true;
  if (args.includes('--interactive') && !terminal) {
    process.stdout.write(
      `${JSON.stringify({ version: 1, ok: false, code: 'tty_required', error: 'Interactive mode needs a terminal. Use personal commands --json or fleet doctor --local --json.' })}\n`
    );
    return 2;
  }
  if (wantsInteractive(args, terminal, Boolean(process.env['CI']))) {
    const { startInteractive } = await import('./ui');
    await startInteractive({
      ...settings,
      version: VERSION,
      commands: COMMANDS,
      execute: (command) => execute(command, settings, VERSION),
    });
    return 0;
  }
  const outcome = await execute(
    args.filter((arg) => arg !== '--interactive'),
    settings,
    VERSION
  );
  const text = args.includes('--json')
    ? JSON.stringify(outcome.data, null, 2)
    : (outcome.text ?? JSON.stringify(outcome.data, null, 2));
  process.stdout.write(`${text}\n`);
  return outcome.exitCode;
}
