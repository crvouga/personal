import type { Command } from 'commander';
import type { CommandOutcome } from './contracts';
import type { Settings } from './settings';
import { resolveSettings } from './settings';
import { executeFleet } from './fleet';
import { syncNode } from './node-sync';
import type { NodeSyncOptions } from './node-sync';

export function registerFlatCommands(
  program: Command,
  defaults: Settings,
  complete: (outcome: CommandOutcome) => void
): void {
  program
    .command('fleet-node-sync')
    .description(
      'Reconcile this node’s locked tools and Codex proxy profile; applies by default'
    )
    .option(
      '--id <name>',
      'Stable node name; defaults to this machine hostname'
    )
    .option('--revision <sha>', 'Reviewed commit; defaults to checkout HEAD')
    .option('--dry-run', 'Preview without changing this node')
    .option('--t3-home <path>', 'T3 base directory')
    .action(async (_options, command: Command) => {
      const options = command.optsWithGlobals<
        NodeSyncOptions & Partial<Settings>
      >();
      const settings = await resolveSettings({ ...defaults, ...options });
      complete(await syncNode(options, settings));
    });
  for (const [name, target, description] of [
    [
      'fleet-status',
      'doctor',
      'Check this computer and all registered fleet nodes',
    ],
    ['fleet-discover', 'discover', 'Find computers visible through Tailscale'],
  ]) {
    program
      .command(name!)
      .description(description!)
      .action(async (_options, command: Command) => {
        const options = command.optsWithGlobals<Partial<Settings>>();
        const settings = await resolveSettings({ ...defaults, ...options });
        complete(await executeFleet(target!, {}, settings));
      });
  }
}
