#!/usr/bin/env node
import { Command } from 'commander';
import { safeCode } from '../domain/errors.ts';
import { emit } from './context.ts';
import { registerSetup } from './setup.ts';
import { registerConnections } from './connect.ts';
import { registerMigration } from './migration.ts';
import { registerIdentityReview } from './identity-review.ts';
import { registerOperations } from './operations.ts';
import { registerMaintenance } from './maintenance.ts';
import { demo } from '../application/demo.ts';
import { registerAuth } from './auth.ts';
import { registerRun } from './run.ts';
const program = new Command()
  .name('password-manager')
  .description('Private, resumable account discovery and Bitwarden maintenance')
  .option('--json', 'Stable JSON output (also the current default)')
  .option('--non-interactive', 'Never prompt or wait for a user')
  .option(
    '--state-dir <directory>',
    'Private local state outside source/sync directories'
  );
registerSetup(program);
registerConnections(program);
registerOperations(program);
registerIdentityReview(program);
registerMigration(program);
registerRun(program);
registerMaintenance(program);
registerAuth(program);
program
  .command('demo')
  .description(
    'Isolated synthetic lifecycle; no live accounts, network or OS secret writes'
  )
  .action(async () => emit(await demo()));
try {
  await program.parseAsync();
} catch (error) {
  emit({ status: 'failed', error: safeCode(error) });
  process.exitCode = 1;
}
