import type { Command } from 'commander';
import { readFile, stat } from 'node:fs/promises';
import { z } from 'zod';
import {
  recordMappings,
  undoMapping,
  aliasMapping,
} from '../application/decisions.ts';
import { reconcile } from '../application/reconcile.ts';
import { action } from './context.ts';
import { ManagerError } from '../domain/errors.ts';
const mapping = z
  .object({
    evidenceId: z.string().max(100),
    origin: z.string().max(500),
    username: z.string().max(320),
    auth: z
      .enum([
        'password',
        'passkey',
        'social',
        'sso',
        'magic-link',
        'hardware-key',
        'unknown',
      ])
      .optional(),
    identityProvider: z.string().max(320).nullable().optional(),
  })
  .strict();
export function registerIdentityReview(program: Command): void {
  const accounts = program.commands.find((c) => c.name() === 'accounts')!;
  accounts
    .command('decisions')
    .action(action(program, async (app) => app.state.list('decisions')));
  accounts.command('undo <decision-id>').action(async (id: string) =>
    action(program, async (app) => {
      app.state.transaction(() => {
        undoMapping(app.state, id);
        reconcile(app.state, app.config.priorityOrigins);
      });
      return { status: 'completed', decisionId: id };
    })()
  );
  accounts
    .command('alias <account-id> <evidence-id>')
    .action(async (accountId: string, evidenceId: string) =>
      action(program, async (app) => {
        const decisions = app.state.transaction(() => {
          const result = recordMappings(
            app.state,
            [aliasMapping(app.state, accountId, evidenceId)],
            app.runtime
          );
          reconcile(app.state, app.config.priorityOrigins);
          return result;
        });
        return { status: 'recorded-user-confirmation', decisions };
      })()
    );
  accounts.command('confirm-batch <file>').action(async (file: string) =>
    action(program, async (app) => {
      if ((await stat(file)).size > 1024 * 1024)
        throw new ManagerError('invalid-input');
      const parsed = z
        .array(mapping)
        .max(1000)
        .safeParse(JSON.parse(await readFile(file, 'utf8')));
      if (!parsed.success) throw new ManagerError('invalid-input');
      return app.state.transaction(() => {
        const decisions = recordMappings(app.state, parsed.data, app.runtime);
        reconcile(app.state, app.config.priorityOrigins);
        return { status: 'recorded-user-confirmation', decisions };
      });
    })()
  );
  const evidence = program.command('evidence');
  evidence
    .command('list')
    .option('--source <id>')
    .option('--category <category>')
    .action(async (options: { source?: string; category?: string }) =>
      action(program, async (app) =>
        app.state
          .list('evidence')
          .filter(
            (e) =>
              (!options.source || e.sourceId === options.source) &&
              (!options.category || e.category === options.category)
          )
      )()
    );
}
