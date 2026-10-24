import type { Config } from '../domain/config.ts';
import type { Runtime, StateStore } from '../domain/ports.ts';
import type { Plan } from '../domain/model.ts';
import type { Finding } from './audit.ts';
import { createPlan } from './plans.ts';
export function maintenancePlans(input: {
  config: Config;
  state: StateStore;
  runtime: Runtime;
  findings: Finding[];
  accountId?: string;
}): Plan[] {
  const imports = createPlan({ ...input, kind: 'import' });
  const riskAccounts = new Set(
    input.findings
      .filter((f) =>
        ['reused', 'exposed', 'local-length-heuristic-weak'].includes(f.kind)
      )
      .map((f) => f.accountId)
  );
  const rotations = input.state
    .list('accounts')
    .filter((a) => riskAccounts.has(a.id))
    .filter((a) => !input.accountId || a.id === input.accountId)
    .map((a) => createPlan({ ...input, kind: 'rotate', accountId: a.id }));
  const existing = input.state.list('plans').filter(
    (p) =>
      (!input.accountId ||
        p.operationIds.every(
          (id) =>
            input.state.get('operations', id)?.accountId === input.accountId
        )) &&
      p.operationIds.some((id) => {
        const op = input.state.get('operations', id);
        return (
          op?.planId === p.id &&
          !['completed', 'cancelled', 'failed'].includes(op.state)
        );
      })
  );
  return [
    ...new Map(
      [...existing, imports, ...rotations]
        .filter((p) => p.operationIds.length > 0)
        .map((p) => [p.id, p])
    ).values(),
  ];
}
