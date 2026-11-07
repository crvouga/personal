import type { Command } from 'commander';
import type { Settings } from './settings';
import type { CommandOutcome } from './contracts';
import { fleetSync, type FleetSyncOptions } from './fleet-sync';

/** Alias and nested command share options and execution; legacy fleet sync stays plan-only. */
export function registerFleetSync(
  program: Command,
  fleet: Command,
  settings: Settings,
  complete: (value: CommandOutcome) => void
): void {
  for (const command of [
    program.command('fleet-converge'),
    program.command('fleet-sync'),
    fleet.command('converge'),
  ]) {
    command
      .description(
        'Synchronize the enrolled Ubuntu fleet from this controller over verified SSH'
      )
      .option(
        '--revision <sha>',
        'Approve an exact source commit; defaults to published release or current canonical checkout'
      )
      .option(
        '--node <id>',
        'Explicit enrolled remote target; repeatable',
        (id: string, ids: string[]) => [...ids, id],
        []
      )
      .option(
        '--all',
        'Explicit spelling of the default enrolled fleet scope; never discovered peers'
      )
      .option(
        '--dry-run',
        'Read-only plan; no authentication, enrollment, installation or scheduling'
      )
      .option('--apply', 'Authorize changes; unattended use requires --yes')
      .option('--yes', 'Confirm --apply')
      .option(
        '--schedule <action>',
        'Controller-only schedule: enable, pause, resume, disable, status'
      )
      .action(async (_: unknown, cmd: Command) => {
        const options = cmd.optsWithGlobals<
          FleetSyncOptions & Partial<Settings>
        >();
        complete(
          await fleetSync(options, {
            ...settings,
            ...(options.config ? { config: options.config } : {}),
          })
        );
      });
  }
}
