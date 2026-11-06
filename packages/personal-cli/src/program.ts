import { Command, CommanderError } from 'commander';
import { FleetUsageError } from '../../fleet/src/errors';
import { commandCatalog } from './registry';
import { indexedCommands } from './command-index';
import { registerT3 } from './t3/register';
import { workstationCommand } from './workstation';
import { registerFlatCommands } from './flat-commands';
import { AGENT_GUIDE } from './agent-guide';
import { executeFleet } from './fleet';
import { resolveSettings } from './settings';
import type { Settings } from './settings';
import type { CliOptions } from './options';
import type { CommandOutcome } from './contracts';

export const GLOBAL_OPTIONS = [
  {
    flag: '--json',
    description: 'One versioned JSON document on stdout; never prompt',
  },
  { flag: '--non-interactive', description: 'Never open interactive prompts' },
  {
    flag: '--workspace <path>',
    description: 'Existing controller checkout; does not clone or change it',
  },
  { flag: '--config <path>', description: 'Local, secret-free fleet roster' },
];

function common(command: Command): Command {
  return command
    .option(
      '--node <id>',
      'Select an existing node; repeat for multiple nodes',
      collect,
      []
    )
    .option('--local', 'Controller only; no roster or SSH required')
    .option(
      '--all',
      'All targets: doctor uses the roster; repair uses the visible tailnet'
    )
    .option(
      '--require <capabilities>',
      'Controller capabilities, comma separated, or none'
    )
    .option('--timeout <ms>', 'Per-node deadline, 1000–1800000 milliseconds')
    .option('--strict', 'Warnings and skipped checks also produce exit 1')
    .option(
      '--repair <ids>',
      'Repair only: workspace,workstation,providers; comma separated'
    )
    .option(
      '--plan-hash <sha256>',
      'Repair only: require the reviewed plan to match current diagnostics'
    )
    .option(
      '--script',
      'Repair only: generate a reviewable POSIX script without executing it'
    )
    .option(
      '--pull',
      'Sync only: explicitly request a clean, fast-forward pull'
    )
    .option(
      '--apply',
      'Authorize the displayed roster/sync/repair mutation; requires --yes'
    )
    .option('--yes', 'Confirm an explicitly requested --apply operation');
}

function collect(value: string, previous: string[]): string[] {
  return [...previous, value];
}

function createProgram(
  version: string,
  output: (text: string) => void
): Command {
  const program = new Command()
    .name('personal')
    .description(
      'Developer fleet and T3 reconciliation · help by default, structured for agents'
    )
    .version(version)
    .exitOverride()
    .configureOutput({ writeOut: output, writeErr: () => undefined })
    .showSuggestionAfterError(false)
    .addHelpCommand('help [command]', 'Show help for a command')
    .option(
      '--interactive',
      'Open the interactive terminal application (TTY required)'
    );
  for (const option of GLOBAL_OPTIONS)
    program.option(option.flag, option.description);
  program.addHelpText(
    'after',
    '\nAgent discovery: personal index --json; personal agent --json; personal <command> --help.\nNo command prints help. Use --interactive explicitly for the terminal menu.\nMutations: fleet-node-sync, t3-apply, t3-cleanup and t3-import apply on invocation.\nUse --dry-run to preview sync/apply/cleanup; inspect t3-plan before importing.\nLegacy fleet writes require --apply --yes. --json does not make a command read-only.'
  );
  return program;
}

function fleetCommands(program: Command): Command[] {
  const fleet = program
    .command('fleet')
    .description('Diagnose, explore and onboard developer computers');
  const definitions = commandCatalog().filter(
    (entry) =>
      entry.group === 'Fleet' &&
      entry.args[0] === 'fleet' &&
      entry.id !== 'fleet doctor local'
  );
  return definitions.map((entry) => {
    const command = common(
      fleet.command(entry.args[1]!).description(entry.description)
    );
    if (entry.args[1] === 'add')
      command
        .requiredOption('--id <name>', 'Unique lowercase node ID')
        .requiredOption(
          '--ssh <alias>',
          'Existing OpenSSH alias; never writes SSH configuration'
        )
        .requiredOption(
          '--path <path>',
          'Absolute POSIX checkout path on the node'
        )
        .option(
          '--runtime <path>',
          'Optional absolute Node/Bun runtime; defaults to node on SSH PATH'
        );
    command.addHelpText(
      'after',
      `\nExample: ${entry.examples[0]}\nWrites require both --apply and --yes. Diagnostics never log in or repair automatically.`
    );
    return command;
  });
}

function catalog(options: CliOptions, version: string): CommandOutcome {
  const commands = indexedCommands(options.search, options.group);
  return {
    exitCode: 0,
    data: {
      version: 1,
      cliVersion: version,
      command: 'commands',
      ok: true,
      commands,
      globalOptions: GLOBAL_OPTIONS,
      agentGuide: 'personal agent --json',
      index: 'personal index --json',
      defaultCommand: 'help',
      schema: 'personal fleet schema --json',
    },
    text: [
      'Personal command catalog',
      ...commands.map((entry) => `\n  ${entry.id}\n    ${entry.description}`),
      '\nUse personal <command> --help for options; personal --interactive opens the menu.',
    ].join('\n'),
  };
}

export async function execute(
  args: string[],
  defaults: Settings,
  version: string
): Promise<CommandOutcome> {
  let outcome: CommandOutcome | undefined;
  let output = '';
  const program = createProgram(version, (text) => {
    output += text;
  });
  registerT3(program, defaults, (result) => {
    outcome = result;
  });
  registerFlatCommands(program, defaults, (result) => {
    outcome = result;
  });
  registerWorkstation(program, defaults, (result) => {
    outcome = result;
  });
  const commands = fleetCommands(program);
  for (const command of commands)
    command.action(async () => {
      const options = command.optsWithGlobals<CliOptions>();
      const settings = await resolveSettings({
        ...defaults,
        ...settingsOverrides(options),
      });
      outcome = await executeFleet(command.name(), options, settings);
    });
  program
    .command('commands')
    .alias('index')
    .description('Search the complete command catalog')
    .option('--search <text>', 'Filter names, descriptions and keywords')
    .option('--group <name>', 'Filter category, for example Fleet or Reference')
    .action((_options, command: Command) => {
      outcome = catalog(command.optsWithGlobals<CliOptions>(), version);
    });
  program
    .command('agent')
    .description('Machine-readable usage and safety contract')
    .action(() => {
      outcome = { exitCode: 0, data: AGENT_GUIDE };
    });
  program.action(() => {
    if (program.opts<CliOptions>().json)
      outcome = catalog(program.opts<CliOptions>(), version);
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

function settingsOverrides(options: CliOptions): Partial<Settings> {
  return {
    ...(options.workspace ? { workspace: options.workspace } : {}),
    ...(options.config ? { config: options.config } : {}),
  };
}

function commandError(error: unknown, output: string): CommandOutcome {
  if (error instanceof CommanderError && error.exitCode === 0)
    return {
      exitCode: 0,
      data: { version: 1, help: output.trim() },
      text: output.trim(),
    };
  const usage =
    error instanceof CommanderError || error instanceof FleetUsageError;
  return {
    exitCode: usage ? 2 : 1,
    data: {
      version: 1,
      ok: false,
      code: usage ? 'invalid_usage' : 'operation_failed',
      error:
        error instanceof FleetUsageError
          ? error.message
          : usage
            ? 'Invalid command or option. Run personal --help or personal commands --json.'
            : 'Operation failed. Inspect configuration and permissions locally; raw errors are withheld to protect credentials.',
    },
  };
}

function registerWorkstation(
  program: Command,
  defaults: Settings,
  complete: (outcome: CommandOutcome) => void
): void {
  program
    .command('workstation [args...]')
    .description(
      'Local configuration, tools, agent profiles and launcher lifecycle'
    )
    .allowUnknownOption()
    .addHelpText(
      'after',
      '\nDomains: tools, agents, opencode, openrouter, net.\nLocal operations: status, sync, doctor, cleanup, install, uninstall, update, vault.\nExamples: personal workstation tools check --json --non-interactive\n          personal workstation agents verify --node NODE --tool codex --profile proxy --json\nLeaf operations/help require the personal checkout and Bun. Use --workspace PATH or PERSONAL_WORKSPACE.\nInspect leaf --help for mutation controls; native agent launches stream native output.'
    )
    .action(async (args: string[], _options, command: Command) => {
      if (args.length === 0) command.help();
      const options = command.optsWithGlobals<CliOptions>();
      const settings = await resolveSettings({
        ...defaults,
        ...settingsOverrides(options),
      });
      complete(await workstationCommand(args, settings));
    });
}
