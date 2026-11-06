import type { Command } from 'commander';
import type { CommandOutcome } from '../contracts';
import { resolveSettings, type Settings } from '../settings';
import { t3Command } from './command';
import type { T3Options } from './desired';

export const T3_COMMANDS = [
  ['t3-plan', 'Preview creates, updates and owned removals'],
  ['t3-apply', 'Reconcile declared T3 provider instances'],
  ['t3-status', 'Check managed T3 configuration for drift'],
  [
    't3-cleanup',
    'Remove only provider instances recorded in personal ownership state',
  ],
  ['t3-import', 'Adopt an existing provider instance into personal ownership'],
] as const;

export function registerT3(
  program: Command,
  defaults: Settings,
  complete: (outcome: CommandOutcome) => void
): void {
  for (const [name, description] of T3_COMMANDS) {
    program
      .command(name)
      .description(description)
      .option('--id <name>', 'Node ID; defaults to hostname')
      .option(
        '--t3-home <path>',
        'T3 base directory; defaults to T3CODE_HOME or ~/.t3'
      )
      .option(
        '--definition <path>',
        'Version 1 declarative T3 provider definition'
      )
      .option(
        '--plan-hash <sha256>',
        'Reject any changes since the reviewed plan'
      )
      .option('--dry-run', 'Preview without writing configuration or state')
      .option('--instance <id>', 'Existing instance to adopt with t3-import')
      .action(async (_options, command: Command) => {
        const options = command.optsWithGlobals<
          T3Options & Partial<Settings>
        >();
        const settings = await resolveSettings({ ...defaults, ...options });
        complete(await t3Command(name, options, settings));
      });
  }
}
