import type { Command } from 'commander';
import { configureImport } from '../application/migration-config.ts';
import { unlocked } from './context.ts';
import { migrationPlan } from '../application/migration-plan.ts';
import { revisePlan, discardPlan } from '../application/authorization.ts';
import { action, workflow } from './context.ts';
import { ManagerError } from '../domain/errors.ts';
export function registerMigration(program: Command): void {
  const plan = program.commands.find((c) => c.name() === 'plan')!;
  plan.command('revise <id>').action(async (id: string) =>
    action(program, async (app) =>
      revisePlan(
        app.state,
        id,
        app.runtime,
        app.config.bitwarden
          ? {
              server: app.config.bitwarden.server,
              email: app.config.bitwarden.email,
            }
          : null
      )
    )()
  );
  plan.command('discard <id>').action(async (id: string) =>
    action(program, async (app) => {
      discardPlan(app.state, id);
      return { status: 'cancelled' };
    })()
  );
  registerImportCommands(program);
}
function registerImportCommands(program: Command): void {
  const imports = program.command('imports');
  imports.command('choose <evidence-id>').action(async (evidenceId: string) =>
    action(program, async (app) =>
      migrationPlan({
        context: app,
        config: app.config,
        evidenceId,
        vaultId: null,
        mode: 'create',
      })
    )()
  );
  imports
    .command('configure <evidence-id>')
    .option('--folder-id <id>', 'Existing folder id, or none')
    .option('--personal', 'Explicitly select personal ownership')
    .action(
      async (
        evidenceId: string,
        options: { folderId?: string; personal?: boolean }
      ) =>
        action(program, (app) =>
          unlocked(app, async () => {
            await configureImport(workflow(app), { evidenceId, ...options });
            return { status: 'configured', evidenceId };
          })
        )()
    );
  imports
    .command('list')
    .action(action(program, async (app) => app.state.list('imports')));
  imports
    .command('resolve <evidence-id>')
    .requiredOption('--vault-item <id>')
    .requiredOption(
      '--mode <mode>',
      'merge-metadata, replace-password, or preserve'
    )
    .action(
      async (
        evidenceId: string,
        options: { vaultItem: string; mode: string }
      ) =>
        action(program, async (app) => {
          if (
            !['merge-metadata', 'replace-password', 'preserve'].includes(
              options.mode
            )
          )
            throw new ManagerError('invalid-input');
          return migrationPlan({
            context: app,
            config: app.config,
            evidenceId,
            vaultId: options.vaultItem,
            mode: options.mode as
              'merge-metadata' | 'replace-password' | 'preserve',
          });
        })()
    );
}
