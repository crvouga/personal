import { join } from 'node:path';
import { runCommand } from '../../fleet/src/runner';
import type { Settings } from './settings';
import type { CommandOutcome } from './contracts';

/** The public Node CLI delegates Bun-only local operations to its source checkout. */
export async function workstationCommand(
  args: string[],
  settings: Settings
): Promise<CommandOutcome> {
  const help = args.length === 0 || args.includes('--help');
  const result = await runCommand(
    [
      'bun',
      join(settings.workspace, 'packages/workstation/cli/internal.ts'),
      ...(help
        ? [...args, '--help']
        : [...args, '--json', '--non-interactive']),
    ],
    { cwd: settings.workspace, timeoutMs: 1_200_000 }
  );
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
    if (['--workspace', '--config'].includes(args[index]!)) {
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
