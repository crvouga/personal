import type { Command } from 'commander';
import { discover } from '../application/discover.ts';
import { audit } from '../application/audit.ts';
import { maintenancePlans } from '../application/run-plans.ts';
import { authorizePlan } from '../application/plans.ts';
import { maintenanceReport } from '../application/maintenance-report.ts';
import { applyPlan } from '../application/apply.ts';
import { action, unlocked, workflow, type AppContext } from './context.ts';
interface RunOptions {
  source?: string;
  account?: string;
}
export function registerRun(program: Command): void {
  const run = program
    .command('run')
    .description(
      'Discover, reconcile, audit, plan and execute only configured policy'
    )
    .option('--source <id>')
    .option('--account <id>');
  run.action(
    action(program, (app) =>
      app.state.withLock('integrated-run', () =>
        unlocked(app, () => executeRun(app, run.opts<RunOptions>()))
      )
    )
  );
}
async function executeRun(app: AppContext, options: RunOptions) {
  const cancelled = () => app.controller.signal.aborted;
  const coverage = await discover({
    ...app,
    context: { ...app, fetch },
    ...(options.source ? { sourceId: options.source } : {}),
    cancelled,
  });
  const findings = await audit({ ...app, network: false });
  const selected = maintenancePlans({
    ...app,
    findings,
    ...(options.account ? { accountId: options.account } : {}),
  });
  const results = [];
  for (const plan of selected) {
    if (
      cancelled() ||
      (!plan.authorizedAt && !policyPermits(app, plan.operationIds))
    )
      continue;
    if (!plan.authorizedAt) authorizePlan(app.state, plan.id, app.runtime);
    results.push(
      await applyPlan(
        { ...workflow(app), deferUserActions: !app.interactive },
        plan.id
      )
    );
  }
  const maintenance = maintenanceReport({
    ...app,
    status: cancelled() ? 'cancelled' : 'inspection',
  });
  const status = runStatus({
    cancelled: cancelled(),
    states: results.map((r) => r.state),
    sourceStates: coverage.map((c) => c.state),
    pendingPlans: selected.length,
    pendingActions: app.state
      .list('actions')
      .filter((a) => a.status === 'pending').length,
  });
  app.state.put('maintenance', {
    ...app.state.get('maintenance', maintenance.id)!,
    status,
  });
  return {
    status,
    maintenance: { ...maintenance, status },
    coverage,
    findings,
    plans: selected,
    runs: results,
    next: selected.length
      ? `bun run password-manager apply ${selected[0]!.id}`
      : 'bun run password-manager actions list',
  };
}
function policyPermits(app: AppContext, ids: string[]): boolean {
  const policy = app.config.execution;
  if (!policy.autoApply) return false;
  return ids.every((id) => {
    const op = app.state.get('operations', id)!;
    const account = app.state.get('accounts', op.accountId)!;
    return (
      policy.allowedKinds.includes(op.kind as 'import' | 'rotate') &&
      policy.allowedOrigins.includes(account.origin) &&
      policy.allowedAccounts.includes(account.id)
    );
  });
}
function runStatus(input: {
  cancelled: boolean;
  states: string[];
  sourceStates: string[];
  pendingPlans: number;
  pendingActions: number;
}): string {
  if (input.cancelled) return 'cancelled';
  if (input.sourceStates.some((s) => ['failed', 'incomplete'].includes(s)))
    return 'partial';
  const result = operationRunStatus(input.states);
  if (result) return result;
  if (input.sourceStates.some((s) => !['scanned', 'skipped'].includes(s)))
    return 'requires-user-action';
  if (!input.sourceStates.length) return 'requires-user-action';
  if (input.pendingActions || input.pendingPlans > input.states.length)
    return 'requires-user-action';
  return 'completed';
}

function operationRunStatus(states: string[]): string | null {
  if (states.length && states.every((s) => s === 'failed')) return 'failed';
  if (states.some((s) => ['partial', 'cancelled'].includes(s)))
    return 'partial';
  if (states.some((s) => s !== 'completed')) return 'requires-user-action';
  return null;
}
