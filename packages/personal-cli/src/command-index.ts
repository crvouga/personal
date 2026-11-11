import { SOURCE_OPERATIONS } from './source-operations';
import { commandCatalog } from './registry';
import type { CommandSpec } from './contracts';

/** Machine-readable discovery for agents. */
export function indexedCommands(search = '', group?: string) {
  return commandCatalog(search, group).map((entry) => ({
    ...entry,
    help: `personal ${entry.args.join(' ')} --help`,
    execution: execution(entry),
  }));
}

function execution(entry: CommandSpec) {
  if (Object.hasOwn(SOURCE_OPERATIONS, entry.id))
    return {
      default: 'depends-on-subcommand',
      authorization: 'owner-specific; inspect leaf help before invocation',
      requirements: ['Personal checkout and shared toolchain'],
      note: 'Streams the owner protocol. JSON and mutation flags depend on the leaf operation.',
    };
  if (entry.id === 'workstation')
    return {
      default: 'help',
      mutation: 'depends-on-subcommand',
      requirements: ['Personal checkout and Bun for workstation operations'],
      note: 'Inspect leaf --help; use --json --non-interactive for diagnostics. Native agent launches stream native output.',
    };
  return { default: 'read-only', authorization: 'none' };
}
