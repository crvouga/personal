import { blocking, type Check, type Runner } from '../../fleet/src/types';
import type { FleetDefinition } from '../../fleet/src/definition';
import type { ManagerNode } from '../../fleet/src/manager-sync';
import { hostId } from '../../fleet/src/topology';
import { convergeProxy } from '../../fleet/src/proxy-converge';
import { convergeManagerHub } from '../../workstation/cli/lib/monitoring/manager-hub';

/** The manager converges itself locally (never over SSH) before any worker:
 * it must be the declared manager, stay awake on AC power, and host every
 * singleton service (CLI proxy, Beszel hub). Workers only consume them.
 */
export async function convergeManager(
  definition: FleetDefinition,
  input: { revision: string; apply: boolean; workspace: string },
  run: Runner
): Promise<ManagerNode> {
  const started = Date.now();
  const id = definition.manager.id;
  const identity = await managerIdentity(id, run);
  const checks: Check[] = [identity];
  if (identity.status === 'pass') {
    checks.push(await managerPower(run));
    checks.push(
      ...(await convergeProxy(id, input.revision, run, {
        apply: input.apply,
        cwd: input.workspace,
      }))
    );
    if (input.apply)
      checks.push(
        ...(await convergeManagerHub(input.workspace, definition, run))
      );
  }
  return {
    node: id,
    role: 'manager',
    checks,
    reachability: 'online',
    desiredRevision: input.revision,
    appliedRevision:
      input.apply && !checks.some(blocking) ? input.revision : null,
    durationMs: Date.now() - started,
  };
}

/** fleet-sync runs only on the declared manager. */
export async function managerIdentity(id: string, run: Runner): Promise<Check> {
  const result = await run(['scutil', '--get', 'LocalHostName']);
  const local = result.ok ? hostId(result.stdout.trim()) : '';
  return local === id
    ? {
        id: 'manager:identity',
        status: 'pass',
        summary: `This machine is the declared fleet manager (${id}).`,
      }
    : {
        id: 'manager:identity',
        status: 'fail',
        summary: 'FLEET_NOT_MANAGER',
        remedy: {
          action: `Run fleet-sync on the manager (${id}). Workers are never controlled from another worker; change the manager only by editing manager in packages/fleet/definition.json and moving its singleton services.`,
        },
      };
}

/** Workers depend on the manager's services, so it never sleeps on AC power. */
export async function managerPower(run: Runner): Promise<Check> {
  const result = await run(['pmset', '-g', 'custom']);
  const ac = result.ok ? (result.stdout.split('AC Power:')[1] ?? '') : '';
  const sleep = /^\s*sleep\s+(\d+)/m.exec(ac)?.[1];
  return sleep === '0'
    ? {
        id: 'manager:power',
        status: 'pass',
        summary: 'The manager never sleeps on AC power.',
      }
    : {
        id: 'manager:power',
        status: 'fail',
        summary: 'MANAGER_SLEEPS_ON_POWER',
        remedy: {
          action:
            'Workers lose the CLI proxy and Beszel hub while the manager sleeps. Apply the manager power policy once: ansible-playbook -K packages/workstation/macos/manager.yml',
        },
      };
}
