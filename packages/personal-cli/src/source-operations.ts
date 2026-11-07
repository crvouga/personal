import { createRequire } from 'node:module';
import type { Command } from 'commander';
import type { CommandOutcome } from './contracts';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import type { Settings } from './settings';

/** Private owners implement domains; personal is their only user entry point. */
export const SOURCE_OPERATIONS: Record<string, string[]> = {
  'password-manager': ['node', 'packages/password-manager/src/cli/main.ts'],
  cliproxy: ['python3', '-B', 'packages/cliproxy-fleet/scripts/cli.py'],
  health: ['bun', 'packages/infra/scripts/health.ts'],
  'health-fix': ['bun', 'scripts/health-fix.ts'],
  domains: ['bun', 'packages/infra/scripts/domains.ts'],
  vault: ['bash', 'packages/vault-service/cli/bin/internal.sh'],
};

export function sourceOperation(args: string[]): string | undefined {
  return args[0] && Object.hasOwn(SOURCE_OPERATIONS, args[0])
    ? args[0]
    : undefined;
}

export async function forwardSourceOperation(
  args: string[],
  settings: Settings
): Promise<number> {
  const [runtime, ...ownerArgs] = SOURCE_OPERATIONS[args[0]!]!;
  const resolved = ownerArgs.map((arg) =>
    arg.startsWith('packages/') || arg.startsWith('scripts/')
      ? join(settings.workspace, arg)
      : arg
  );
  const prelude =
    args[0] === 'password-manager'
      ? [
          '--import',
          createRequire(
            join(settings.workspace, 'packages/password-manager/package.json')
          ).resolve('tsx'),
        ]
      : [];
  return new Promise((resolve) => {
    const child = spawn(runtime!, [...prelude, ...resolved, ...args.slice(1)], {
      cwd: args[0] === 'vault' ? process.cwd() : settings.workspace,
      stdio: 'inherit',
    });
    child.on('error', () => {
      process.stderr.write(
        'This personal command requires the source checkout and shared toolchain.\n'
      );
      resolve(1);
    });
    child.on('exit', (code) => resolve(code ?? 1));
  });
}

export function registerSourceOperations(
  program: Command,
  defaults: Settings,
  complete: (result: CommandOutcome) => void
): void {
  for (const name of Object.keys(SOURCE_OPERATIONS)) {
    program
      .command(`${name} [args...]`)
      .description(
        `Source-owned ${name} operations; requires the personal checkout`
      )
      .allowUnknownOption()
      .action(async (args: string[]) => {
        const exitCode = await forwardSourceOperation(
          [name, ...args],
          defaults
        );
        complete({ exitCode, data: { version: 1, ok: exitCode === 0 } });
      });
  }
}
