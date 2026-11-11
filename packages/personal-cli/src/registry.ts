import { SOURCE_OPERATIONS } from './source-operations';
import type { CommandSpec } from './contracts';
import { searchCommands } from './search';

type Entry = [
  id: string,
  title: string,
  description: string,
  keywords: string[],
  mutation?: boolean,
];

function group(name: string, entries: Entry[]): CommandSpec[] {
  return entries.map(([id, title, description, keywords, mutation]) => ({
    id,
    title,
    description,
    group: name,
    keywords,
    args: id.split(' '),
    examples: [`personal ${id} --json`],
    mutation: mutation === true,
  }));
}

/** One flat, prefixed command surface shared by help and agents. */
export const COMMANDS: CommandSpec[] = [
  ...group(
    'Infra',
    Object.entries(SOURCE_OPERATIONS).map(([id, operation]) => [
      id,
      operation.title,
      `${operation.description} Requires the personal checkout; inspect personal ${id} --help.`,
      operation.keywords,
      operation.mutation,
    ])
  ),
  ...group('Workstation', [
    [
      'workstation',
      'Workstation configuration',
      'Tools, editor configuration, agent profiles, notifications and launcher lifecycle on this machine. Requires the personal checkout and Bun.',
      ['tools', 'agents', 'opencode', 'install', 'sync', 'doctor'],
    ],
  ]),
  ...group('Reference', [
    [
      'commands',
      'Explore the command catalog and agent contract',
      'Search the command index; the JSON document also carries the agent usage/safety contract, release metadata and exit codes.',
      ['search', 'help', 'llm', 'agent', 'api', 'index'],
    ],
  ]),
];

export function commandCatalog(search = '', group?: string): CommandSpec[] {
  return searchCommands(COMMANDS, search).filter(
    (command) => !group || command.group.toLowerCase() === group.toLowerCase()
  );
}
