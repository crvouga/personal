import type { Command } from 'commander';
import { discover } from '../application/discover.ts';
import {
  reconcile,
  inspectMatches,
  confirmEvidence,
} from '../application/reconcile.ts';
import { createPlan, authorizePlan } from '../application/plans.ts';
import { audit } from '../application/audit.ts';
import { applyOperation, applyPlan } from '../application/apply.ts';
import { skipAction } from '../application/actions.ts';
import { ManagerError } from '../domain/errors.ts';
import { coverageStatus } from '../application/report-status.ts';
import type { OperationKind } from '../domain/model.ts';
import { action, unlocked, workflow } from './context.ts';
export function registerOperations(program: Command): void {
  registerDiscovery(program);
  registerAccounts(program);
  registerPlans(program);
  registerExecution(program);
  registerActions(program);
}
function registerDiscovery(program: Command): void {
  const scan = program.command('discover').option('--source <id>');
  scan.action(
    action(program, (app) => {
      const sourceId = scan.opts<{ source?: string }>().source;
      const work = async () => {
        const coverage = await discover({
          ...app,
          context: { ...app, fetch },
          cancelled: () => app.controller.signal.aborted,
          ...(sourceId ? { sourceId } : {}),
        });
        return {
          status: app.controller.signal.aborted
            ? 'cancelled'
            : coverageStatus(coverage),
          coverage,
        };
      };
      const needsVault = app.config.sources.some(
        (s) => s.kind === 'bitwarden' && (!sourceId || s.id === sourceId)
      );
      return needsVault ? unlocked(app, work) : work();
    })
  );
}
function registerAccounts(program: Command): void {
  const accounts = program.command('accounts');
  accounts
    .command('list')
    .action(action(program, async (app) => app.state.list('accounts')));
  accounts.command('show <id>').action(async (id: string) =>
    action(program, async (app) => ({
      account: app.state.get('accounts', id),
      evidence: app.state
        .list('evidence')
        .filter((e) =>
          app.state.get('accounts', id)?.evidenceIds.includes(e.id)
        ),
    }))()
  );
  accounts.command('reconcile').action(
    action(program, async (app) => ({
      ...reconcile(app.state),
      matches: inspectMatches(app.state),
    }))
  );
  accounts
    .command('confirm <evidence-id>')
    .requiredOption('--origin <origin>')
    .requiredOption('--username <username>')
    .action(async (id: string, options: { origin: string; username: string }) =>
      action(program, async (app) => {
        const decisionId = confirmEvidence(
          app.state,
          { evidenceId: id, ...options },
          app.runtime
        );
        return { status: 'recorded-user-confirmation', decisionId };
      })()
    );
}
function registerPlans(program: Command): void {
  const check = program
    .command('audit')
    .option('--network', 'Authorize privacy-preserving exposure checks');
  check.action(
    action(program, (app) =>
      unlocked(app, () =>
        audit({
          ...app,
          network: Boolean(check.opts<{ network?: boolean }>().network),
        })
      )
    )
  );
  const plan = program
    .command('plan')
    .option('--kind <kind>', 'import or rotate (default: import)', 'import')
    .option('--account <id>');
  plan.command('show <id>').action(async (id: string) =>
    action(program, async (app) => {
      const selected = app.state.get('plans', id);
      if (!selected) throw new ManagerError('missing');
      return {
        ...selected,
        operations: selected.operationIds.map((op) =>
          app.state.get('operations', op)
        ),
      };
    })()
  );
  plan.action(
    action(program, async (app) => {
      const options = plan.opts<{ kind: string; account?: string }>();
      if (!['import', 'rotate'].includes(options.kind))
        throw new ManagerError('invalid-input');
      return createPlan({
        ...app,
        kind: options.kind as OperationKind,
        ...(options.account ? { accountId: options.account } : {}),
      });
    })
  );
}
function registerExecution(program: Command): void {
  program.command('apply <plan-id>').action(async (id: string) =>
    action(program, (app) =>
      unlocked(app, async () => {
        authorizePlan(app.state, id, app.runtime);
        return applyPlan(workflow(app), id);
      })
    )()
  );
  program
    .command('recover <operation-id>')
    .action(async (id: string) =>
      action(program, (app) =>
        unlocked(app, () => applyOperation(workflow(app), id))
      )()
    );
  program.command('resume <run-id>').action(async (id: string) =>
    action(program, (app) =>
      unlocked(app, async () => {
        const run = app.state.get('runs', id);
        if (!run?.planId) throw new ManagerError('missing');
        return applyPlan(workflow(app), run.planId, id);
      })
    )()
  );
  program.command('status').action(
    action(program, async (app) => ({
      accounts: app.state.list('accounts'),
      coverage: app.state.list('coverage'),
      maintenance: app.state.list('maintenance'),
      runs: app.state.list('runs'),
      operations: app.state.list('operations'),
      next: app.state.list('actions').filter((a) => a.status === 'pending'),
    }))
  );
}
function registerActions(program: Command): void {
  const actions = program.command('actions');
  actions
    .command('list')
    .action(
      action(program, async (app) =>
        app.state.list('actions').filter((a) => a.status === 'pending')
      )
    );
  actions
    .command('show <id>')
    .action(async (id: string) =>
      action(program, async (app) => app.state.get('actions', id))()
    );
  actions
    .command('skip <id>')
    .requiredOption(
      '--reason <reason>',
      'deferred, unsupported, or not-my-account'
    )
    .action(async (id: string, options: { reason: string }) =>
      action(program, async (app) => {
        skipAction(app.state, id, options.reason, app.runtime);
        return { status: 'skipped' };
      })()
    );
  actions.command('reopen <id>').action(async (id: string) =>
    action(program, async (app) => {
      const entry = app.state.get('actions', id);
      if (!entry) throw new ManagerError('missing');
      app.state.put('actions', { ...entry, status: 'pending' });
      return { status: 'requires-user-action', resume: entry.resume };
    })()
  );
  actions.command('retry <id>').action(async (id: string) =>
    action(program, (app) =>
      unlocked(app, async () => {
        const entry = app.state.get('actions', id);
        if (!entry?.operationId)
          return {
            status: 'requires-user-action',
            resume: entry?.resume ?? null,
          };
        return applyOperation(workflow(app), entry.operationId);
      })
    )()
  );
}
