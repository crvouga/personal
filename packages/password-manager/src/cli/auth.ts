import type { Command } from 'commander';
import { createPlan } from '../application/plans.ts';
import {
  guidedKind,
  captureIssuedMaterial,
  attestGuided,
} from '../application/guided-auth.ts';
import { action, workflow } from './context.ts';
import { ManagerError } from '../domain/errors.ts';
export function registerAuth(program: Command): void {
  const auth = program.command('auth');
  auth
    .command('plan <kind>')
    .requiredOption('--account <id>')
    .option(
      '--target-factor <label>',
      'Exact provider factor label; required for removal'
    )
    .option(
      '--replacement <operation-id>',
      'Completed tested replacement required for factor removal'
    )
    .action(
      async (
        kind: string,
        options: {
          account: string;
          replacement?: string;
          targetFactor?: string;
        }
      ) =>
        action(program, async (app) =>
          createPlan({
            ...app,
            kind: guidedKind(kind),
            accountId: options.account,
            ...(options.targetFactor
              ? { targetFactor: options.targetFactor }
              : {}),
            ...(options.replacement
              ? { replacementOperationId: options.replacement }
              : {}),
          })
        )()
    );
  auth
    .command('capture <operation-id>')
    .requiredOption('--stdin')
    .action(async (id: string) =>
      action(program, async (app) => {
        let material = '';
        for await (const chunk of process.stdin) {
          material += String(chunk);
          if (material.length > 64 * 1024)
            throw new ManagerError('invalid-input');
        }
        return app.state.withLock(
          `account:${app.state.get('operations', id)?.accountId}`,
          () => captureIssuedMaterial(workflow(app), id, material)
        );
      })()
    );
  auth
    .command('attest <operation-id>')
    .requiredOption('--tested')
    .action(async (id: string) =>
      action(program, (app) =>
        app.state.withLock(
          `account:${app.state.get('operations', id)?.accountId}`,
          async () => attestGuided(workflow(app), id)
        )
      )()
    );
}
