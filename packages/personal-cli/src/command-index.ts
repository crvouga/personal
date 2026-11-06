import { commandCatalog } from './registry';
import type { CommandSpec } from './contracts';

const APPLIES = new Set([
  'fleet-node-sync',
  't3-apply',
  't3-cleanup',
  't3-import',
]);

/** Additive machine-readable discovery; the registry also drives the menu. */
export function indexedCommands(search = '', group?: string) {
  return commandCatalog(search, group).map((entry) => ({
    ...entry,
    help: `personal ${entry.args.join(' ')} --help`,
    execution: execution(entry),
  }));
}

function execution(entry: CommandSpec) {
  if (entry.id === 'workstation')
    return {
      default: 'help',
      mutation: 'depends-on-subcommand',
      requirements: ['Personal checkout and Bun for workstation operations'],
      note: 'Inspect leaf --help; use --json --non-interactive for diagnostics. Native agent launches stream native output.',
    };
  if (APPLIES.has(entry.id))
    return {
      default: 'apply',
      authorization: 'command-invocation',
      preview:
        entry.id === 't3-import'
          ? 'personal t3-plan --json'
          : `personal ${entry.id} --dry-run --json`,
      requiredOptions: entry.id === 't3-import' ? ['--instance ID'] : [],
      note: 'JSON selects output format; it does not prevent writes.',
    };
  if (entry.mutation)
    return {
      default: 'preview',
      authorization: '--apply --yes',
      note: 'Supply required options shown by command --help. A preview does not apply changes.',
    };
  return { default: 'read-only', authorization: 'none' };
}
