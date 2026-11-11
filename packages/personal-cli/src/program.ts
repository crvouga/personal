import { Command, CommanderError } from 'commander';
import { indexedCommands } from './command-index';
import { registerSourceOperations } from './source-operations';
import { registerWorkstation } from './workstation';
import { agentGuide } from './agent-guide';
import type { Settings } from './settings';

interface CliOptions {
  json?: boolean;
  search?: string;
  group?: string;
}
import type { CommandOutcome } from './contracts';

export interface Release {
  version: string;
  /** ISO timestamp recorded when this distribution was built; null for source runs. */
  releasedAt: string | null;
}

export const GLOBAL_OPTIONS = [
  {
    flag: '--json',
    description: 'One versioned JSON document on stdout; never prompt',
  },
  { flag: '--non-interactive', description: 'Never open interactive prompts' },
  {
    flag: '--workspace <path>',
    description: 'The personal checkout; does not clone or change it',
  },
];

export function releaseLabel(release: Release): string {
  return release.releasedAt
    ? `${release.version} (released ${release.releasedAt})`
    : `${release.version} (unreleased source build)`;
}

function createProgram(
  release: Release,
  output: (text: string) => void
): Command {
  const program = new Command()
    .name('personal')
    .description(
      'Platform and workstation operations from the personal checkout'
    )
    .version(releaseLabel(release))
    .exitOverride()
    .configureOutput({ writeOut: output, writeErr: () => undefined })
    .showSuggestionAfterError(false)
    .addHelpCommand('help [command]', 'Show help for a command');
  for (const option of GLOBAL_OPTIONS)
    program.option(option.flag, option.description);
  program.addHelpText(
    'after',
    [
      '',
      `Release: ${releaseLabel(release)}`,
      'Groups: infra-* platform operations from the checkout · workstation this machine.',
      'Fleet machines, T3 and the CLI proxy are managed by dev-fleet: bash scripts/dev/project-action.sh fleet-sync.',
      'Agents: personal commands --json.',
    ].join('\n')
  );
  return program;
}

function catalog(options: CliOptions, release: Release): CommandOutcome {
  const commands = indexedCommands(options.search, options.group);
  return {
    exitCode: 0,
    data: {
      version: 1,
      cliVersion: release.version,
      releasedAt: release.releasedAt,
      command: 'commands',
      ok: true,
      commands,
      globalOptions: GLOBAL_OPTIONS,
      defaultCommand: 'help',
      agent: agentGuide(release),
    },
    text: [
      `Personal command catalog · ${releaseLabel(release)}`,
      ...commands.map((entry) => `\n  ${entry.id}\n    ${entry.description}`),
      '\nUse personal <command> --help for options.',
    ].join('\n'),
  };
}

export async function execute(
  args: string[],
  defaults: Settings,
  version: string | Release
): Promise<CommandOutcome> {
  const release: Release =
    typeof version === 'string' ? { version, releasedAt: null } : version;
  let outcome: CommandOutcome | undefined;
  let output = '';
  const program = createProgram(release, (text) => {
    output += text;
  });
  const complete = (result: CommandOutcome) => {
    outcome = result;
  };
  registerSourceOperations(program, defaults, complete);
  registerWorkstation(program, defaults, complete);
  program
    .command('commands')
    .description('Search the command catalog and agent contract')
    .option('--search <text>', 'Filter names, descriptions and keywords')
    .option('--group <name>', 'Filter group: Infra, Workstation, Reference')
    .action((_options, command: Command) => {
      outcome = catalog(command.optsWithGlobals<CliOptions>(), release);
    });
  program.action(() => {
    if (program.opts<CliOptions>().json)
      outcome = catalog(program.opts<CliOptions>(), release);
    else program.help();
  });
  try {
    await program.parseAsync(args, { from: 'user' });
    return (
      outcome ?? {
        exitCode: 0,
        data: { version: 1, help: output.trim() },
        text: output.trim(),
      }
    );
  } catch (error) {
    return commandError(error, output);
  }
}

function commandError(error: unknown, output: string): CommandOutcome {
  if (error instanceof CommanderError && error.exitCode === 0)
    return {
      exitCode: 0,
      data: { version: 1, help: output.trim() },
      text: output.trim(),
    };
  const usage = error instanceof CommanderError;
  return {
    exitCode: usage ? 2 : 1,
    data: {
      version: 1,
      ok: false,
      code: usage ? 'invalid_usage' : 'operation_failed',
      error: usage
        ? 'Invalid command or option. Run personal --help or personal commands --json.'
        : 'Operation failed. Inspect configuration and permissions locally; raw errors are withheld to protect credentials.',
    },
  };
}
