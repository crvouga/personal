import { join } from 'node:path';
import type { Command } from 'commander';
import { spawnSync } from 'node:child_process';
import { resolveSettings, type Settings } from './settings';
import type { CommandOutcome } from './contracts';

export function registerWorkstation(
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
    .action(
      async (
        args: string[],
        _options,
        command: Command & { optsWithGlobals<T>(): T }
      ) => {
        if (args.length === 0) command.help();
        const options = command.optsWithGlobals<Partial<Settings>>();
        const settings = await resolveSettings({
          ...defaults,
          ...(options.workspace ? { workspace: options.workspace } : {}),
        });
        complete(workstationCommand(args, settings));
      }
    );
}

/** The public Node CLI delegates Bun-only local operations to its source checkout. */
export function workstationCommand(
  args: string[],
  settings: Settings
): CommandOutcome {
  const help = args.length === 0 || args.includes('--help');
  const child = spawnSync(
    'bun',
    [
      join(settings.workspace, 'packages/workstation/cli/internal.ts'),
      ...(help
        ? [...args, '--help']
        : [...args, '--json', '--non-interactive']),
    ],
    { cwd: settings.workspace, timeout: 1_200_000, encoding: 'utf8' }
  );
  const result = { ok: child.status === 0, stdout: child.stdout ?? '' };
  if (help && result.ok)
    return {
      exitCode: 0,
      data: { version: 1, help: result.stdout },
      text: result.stdout,
    };
  if (result.ok) {
    try {
      return { exitCode: 0, data: JSON.parse(result.stdout) as unknown };
    } catch {
      /* Non-JSON output is never surfaced from a failed owner contract. */
    }
  }
  return {
    exitCode: 1,
    data: {
      version: 1,
      ok: false,
      error:
        'Workstation operation failed. Check the personal checkout, Bun, conflicts and per-machine authentication.',
    },
  };
}

/** Preserve terminal and agent protocol streams for native tool launch commands. */
export async function forwardWorkstation(
  args: string[],
  settings: Settings
): Promise<number> {
  const { spawn } = await import('node:child_process');
  const childArgs: string[] = [];
  let commandSeen = false;
  for (let index = 0; index < args.length; index++) {
    if (args[index] === '--workspace') {
      index++;
      continue;
    }
    if (args[index] === 'workstation' && !commandSeen) {
      commandSeen = true;
      continue;
    }
    childArgs.push(args[index]!);
  }
  return new Promise((resolve) => {
    const child = spawn(
      'bun',
      [
        join(settings.workspace, 'packages/workstation/cli/internal.ts'),
        ...(childArgs.length ? childArgs : ['--help']),
      ],
      {
        cwd: settings.workspace,
        stdio: 'inherit',
        env: process.env,
      }
    );
    child.on('error', () => {
      process.stderr.write(
        'Workstation requires the personal checkout and shared Bun toolchain.\n'
      );
      resolve(1);
    });
    child.on('exit', (code) => resolve(code ?? 1));
  });
}
