import { createRequire } from 'node:module';
import type { Command } from 'commander';
import type { CommandOutcome } from './contracts';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import type { Settings } from './settings';

interface SourceOperation {
  title: string;
  description: string;
  keywords: string[];
  mutation: boolean;
  command: string[];
  /** Optional flag that selects a second owner script, for example --fix. */
  variant?: { flag: string; key: string; command: string[] };
}

/** Private owners implement infra-* domains; personal is their only user entry point. */
export const SOURCE_OPERATIONS: Record<string, SourceOperation> = {
  'infra-health': {
    title: 'Platform health report',
    description:
      'Read-only report on whether the live platform matches the inventory. --fix walks each failure with a confirmed guided fixer.',
    keywords: ['health', 'drift', 'dns', 'tls', 'vault', 'fix'],
    mutation: false,
    command: ['bun', 'packages/infra/scripts/health.ts'],
    variant: {
      flag: '--fix',
      key: 'fix',
      command: ['bun', 'scripts/health-fix.ts'],
    },
  },
  'infra-domains': {
    title: 'Domain inventory',
    description: 'Read-only DNS and domain inventory operations.',
    keywords: ['dns', 'domains', 'cloudflare'],
    mutation: false,
    command: ['bun', 'packages/infra/scripts/domains.ts'],
  },
  'infra-vault': {
    title: 'Vault secret injection',
    description:
      'Authenticate to the shared OpenBao instance and run commands with secrets injected as environment variables.',
    keywords: ['vault', 'openbao', 'secrets', 'run', 'login'],
    mutation: true,
    command: ['bash', 'packages/vault-service/cli/bin/internal.sh'],
  },
  'infra-password-manager': {
    title: 'Password manager maintenance',
    description:
      'Private, resumable account discovery and Bitwarden maintenance.',
    keywords: ['bitwarden', 'passwords', 'accounts'],
    mutation: true,
    command: ['node', 'packages/password-manager/src/cli/main.ts'],
  },
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
  const name = args[0]!;
  const operation = SOURCE_OPERATIONS[name]!;
  const rest = args.slice(1);
  const variant =
    operation.variant && rest.includes(operation.variant.flag)
      ? operation.variant
      : undefined;
  const [runtime, ...ownerArgs] = variant?.command ?? operation.command;
  const resolved = ownerArgs.map((arg) =>
    arg.startsWith('packages/') || arg.startsWith('scripts/')
      ? join(settings.workspace, arg)
      : arg
  );
  const prelude =
    name === 'infra-password-manager'
      ? [
          '--import',
          createRequire(
            join(settings.workspace, 'packages/password-manager/package.json')
          ).resolve('tsx'),
        ]
      : [];
  const forwarded = variant ? rest.filter((arg) => arg !== variant.flag) : rest;
  return new Promise((resolve) => {
    const child = spawn(runtime!, [...prelude, ...resolved, ...forwarded], {
      cwd: name === 'infra-vault' ? process.cwd() : settings.workspace,
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
  for (const [name, operation] of Object.entries(SOURCE_OPERATIONS)) {
    const command = program
      .command(`${name} [args...]`)
      .description(`${operation.title}; requires the personal checkout`)
      .allowUnknownOption()
      .addHelpText(
        'after',
        `\n${operation.description}\nArguments are forwarded to the owning implementation; run personal ${name} --help from the checkout for its full usage.`
      );
    if (operation.variant)
      command.option(
        operation.variant.flag,
        'Run the interactive guided fixer instead of the read-only report'
      );
    command.action(async (args: string[], options: Record<string, unknown>) => {
      const flags =
        operation.variant && options[operation.variant.key]
          ? [operation.variant.flag]
          : [];
      const exitCode = await forwardSourceOperation(
        [name, ...flags, ...args],
        defaults
      );
      complete({ exitCode, data: { version: 1, ok: exitCode === 0 } });
    });
  }
}
