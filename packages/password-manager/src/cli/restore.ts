import type { Command } from 'commander';
import { password } from '@inquirer/prompts';
import { extractBackup } from '../application/backup-extract.ts';
import { restoreBackup } from '../application/backup-restore.ts';
import { ManagerError } from '../domain/errors.ts';
import { action } from './context.ts';
export function registerRestore(program: Command, backup: Command): void {
  for (const mode of ['restore', 'extract'] as const)
    backup
      .command(`${mode} <file>`)
      .requiredOption('--destination <directory>')
      .option(
        '--password-stdin',
        'Read independently retained backup password from protected stdin'
      )
      .action(
        async (
          file: string,
          options: { destination: string; passwordStdin?: boolean }
        ) =>
          action(program, async (app) => {
            const key = options.passwordStdin
              ? await readPassword()
              : app.interactive
                ? await password({
                    message: 'Independent backup password (not saved):',
                    mask: true,
                  })
                : null;
            if (!key) throw new ManagerError('requires-user-action');
            if (mode === 'extract')
              return extractBackup({
                file,
                password: key,
                destination: options.destination,
              });
            return restoreBackup({
              file,
              password: key,
              destination: options.destination,
              activeDirectory: app.directory,
            });
          })()
      );
}
async function readPassword(): Promise<string> {
  let value = '';
  for await (const chunk of process.stdin) {
    value += String(chunk);
    if (value.length > 4096) throw new ManagerError('invalid-input');
  }
  return value.replace(/\r?\n$/, '');
}
