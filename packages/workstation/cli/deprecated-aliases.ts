import type { Command } from 'commander';

import { cmdBackup, cmdBackups, cmdReset } from './commands/backup-cmds';
import {
  cmdNotificationsDisable,
  cmdNotificationsEnable,
  cmdNotificationsStatus,
  cmdNotificationsTest,
} from './commands/notifications-cmds';
import { cmdOpencodeSync } from './commands/opencode-cmds';
import { cmdProvidersList } from './commands/providers-cmds';
import {
  cmdSoundsList,
  cmdSoundsReset,
  cmdSoundsSet,
} from './commands/sounds-cmds';
import type { GlobalOpts } from './lib/cli-opts';
import { printWarn } from './lib/output-and-theme';

function deprecated(path: string): void {
  printWarn(`deprecated: use \`personal workstation ${path}\` instead`);
}

/** Flat aliases for the pre-domain CLI. Each forwards to its domain path. */
export function registerDeprecatedAliases(
  program: Command,
  globals: () => GlobalOpts
): void {
  aliasProviders(program, globals);
  aliasNotifications(program, globals);
  aliasSounds(program, globals);
  aliasBackups(program, globals);
}

function aliasProviders(program: Command, globals: () => GlobalOpts): void {
  const providers = program
    .command('providers', { hidden: true })
    .description('(deprecated: use `personal workstation opencode providers`)');
  providers
    .command('list')
    .description(
      '(deprecated: use `personal workstation opencode providers list`)'
    )
    .action(async () => {
      deprecated('opencode providers list');
      await cmdProvidersList(globals());
    });
  providers
    .command('sync')
    .description(
      '(deprecated: use `personal workstation opencode providers sync`)'
    )
    .option('--strict', 'Fail when Vault is unavailable')
    .action(async (opts: { strict?: boolean | undefined }) => {
      deprecated('opencode providers sync');
      await cmdOpencodeSync({ ...globals(), strict: opts.strict });
    });
}

function aliasNotifications(program: Command, globals: () => GlobalOpts): void {
  const notifications = program
    .command('notifications', { hidden: true })
    .description(
      '(deprecated: use `personal workstation opencode notifications`)'
    );
  notifications
    .command('status')
    .description('(deprecated)')
    .action(async () => {
      deprecated('opencode notifications status');
      await cmdNotificationsStatus(globals());
    });
  notifications
    .command('enable')
    .description('(deprecated)')
    .action(async () => {
      deprecated('opencode notifications enable');
      await cmdNotificationsEnable(globals());
    });
  notifications
    .command('disable')
    .description('(deprecated)')
    .action(async () => {
      deprecated('opencode notifications disable');
      await cmdNotificationsDisable(globals());
    });
  notifications
    .command('test')
    .description('(deprecated)')
    .option(
      '--kind <kind>',
      'finished|interrupted|question|permission|error',
      'finished'
    )
    .action(async (opts: { kind: string }) => {
      deprecated('opencode notifications test');
      await cmdNotificationsTest(opts.kind, globals());
    });
}

function aliasSounds(program: Command, globals: () => GlobalOpts): void {
  const sounds = program
    .command('sounds', { hidden: true })
    .description(
      '(deprecated: use `personal workstation opencode notifications sounds`)'
    );
  sounds
    .command('list')
    .description('(deprecated)')
    .action(async () => {
      deprecated('opencode notifications sounds list');
      await cmdSoundsList(globals());
    });
  sounds
    .command('set <kind> <sound>')
    .description('(deprecated)')
    .action(async (kind: string, sound: string) => {
      deprecated('opencode notifications sounds set');
      await cmdSoundsSet(kind, sound, globals());
    });
  sounds
    .command('reset')
    .description('(deprecated)')
    .action(async () => {
      deprecated('opencode notifications sounds reset');
      await cmdSoundsReset(globals());
    });
}

function aliasBackups(program: Command, globals: () => GlobalOpts): void {
  program
    .command('backup', { hidden: true })
    .description('(deprecated: use `personal workstation opencode backup`)')
    .action(async () => {
      deprecated('opencode backup');
      await cmdBackup(globals());
    });
  program
    .command('backups', { hidden: true })
    .description('(deprecated: use `personal workstation opencode backups`)')
    .action(async () => {
      deprecated('opencode backups');
      await cmdBackups(globals());
    });
  program
    .command('reset', { hidden: true })
    .description('(deprecated: use `personal workstation opencode reset`)')
    .action(async () => {
      deprecated('opencode reset');
      await cmdReset(globals());
    });
}
