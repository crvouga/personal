import { blocking, type Check, type Runner } from '../../fleet/src/types';
import type { FleetDefinition } from '../../fleet/src/definition';
import type { ManagerNode } from '../../fleet/src/manager-sync';
import { hostId } from '../../fleet/src/topology';
import { convergeProxy } from '../../fleet/src/proxy-converge';
import { attempt } from '../../fleet/src/node-converge-shared';
import {
  quotaLimited,
  verifyFleetProviders,
} from '../../workstation/cli/lib/agents/fleet-verify';
import { verifyNativeAgents } from '../../workstation/cli/lib/agents/native-verify';
import { syncAntigravityKey } from '../../workstation/cli/lib/platform/t3-secrets';
import { proxyKey } from '../../workstation/cli/lib/agents/secrets';
import { convergeManagerHub } from '../../workstation/cli/lib/monitoring/manager-hub';
import { enrollManagerMonitoring } from './fleet-sync-monitoring';
import { desired, nodeId, paths } from './t3/desired';
import { reconcileT3 } from './t3/reconcile';

/** The manager converges itself locally (never over SSH) before any worker:
 * it must be the declared manager, stay awake on AC power, and host every
 * singleton service (CLI proxy, Beszel hub). Workers only consume them.
 */
export async function convergeManager(
  definition: FleetDefinition,
  input: {
    revision: string;
    apply: boolean;
    workspace: string;
    /** Also apply proxy updates that restart the gateway. */
    maintenance?: boolean;
  },
  run: Runner
): Promise<ManagerNode> {
  const started = Date.now();
  const id = definition.manager.id;
  const identity = await managerIdentity(id, run);
  const checks: Check[] = [identity];
  if (identity.status === 'pass') {
    checks.push(await managerPower(run));
    checks.push(await managerProviders(id, input.workspace, input.apply));
    if (input.apply) checks.push(await syncAntigravityKey(proxyKey));
    if (input.apply) {
      // Same provider profiles and the same Vault gateway credential as every
      // worker: the instances above launch from these profiles, and the check
      // proves the credential works end to end through the shared proxy.
      checks.push(
        ...(await attempt('configuration:apply', () =>
          managerAgentProfiles(id, input.workspace, run)
        ))
      );
      const providers = await attempt('provider:verification', () =>
        verifyFleetProviders(id)
      );
      checks.push(...providers);
      // Same agents, versions and shared accounts as every worker.
      checks.push(
        ...(await attempt('agent:verification', () =>
          verifyNativeAgents(id, input.workspace, run, {
            outOfQuota: quotaLimited(providers),
          })
        ))
      );
    }
    checks.push(
      ...(await convergeProxy(id, input.revision, run, {
        apply: input.apply,
        maintenance: Boolean(input.maintenance),
        cwd: input.workspace,
      }))
    );
    if (input.apply) {
      const hub = await convergeManagerHub(input.workspace, definition, run);
      checks.push(...hub);
      // The manager is always a monitored system on its own hub.
      if (!hub.some(blocking))
        checks.push(
          ...(await enrollManagerMonitoring(definition, input.workspace, run))
        );
    }
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

/** The manager's T3 must offer the same managed provider instances as every
 * worker (workers receive them through T3 administrator policy). The manager's
 * T3 is the human's own app with no administrator policy, so the same declared
 * instances are reconciled into its settings with the ownership-safe t3-apply
 * engine: unrelated settings and unmanaged instances are preserved, an existing
 * unowned instance of the same ID is reported, never overwritten.
 */
export async function managerProviders(
  id: string,
  workspace: string,
  apply: boolean,
  t3Home?: string
): Promise<Check> {
  const remedy = {
    action:
      'Run personal t3-apply --dry-run on the manager and review any conflicting instance; adopt it with t3-apply --import ID only if it should be managed.',
  };
  try {
    const target = paths(t3Home ? { t3Home } : {}, workspace);
    const instances = await desired(target.definition, workspace, nodeId(id));
    const plan = await reconcileT3(target, instances, { apply: false });
    const result =
      apply && plan.ok && plan.changed
        ? await reconcileT3(target, instances, {
            apply: true,
            planHash: plan.planHash,
          })
        : plan;
    if (!result.ok)
      return {
        id: 't3:providers',
        status: 'fail',
        summary: 'T3_PROVIDER_CONFLICT',
        remedy,
      };
    return result.changed && !apply
      ? {
          id: 't3:providers',
          status: 'warn',
          summary: 'T3_PROVIDERS_PENDING',
          remedy,
        }
      : {
          id: 't3:providers',
          status: 'pass',
          summary:
            'The manager T3 offers the same managed provider instances as every worker.',
        };
  } catch {
    return {
      id: 't3:providers',
      status: 'fail',
      summary: 'T3_PROVIDERS_UNVERIFIED',
      remedy,
    };
  }
}

const PROFILE_TOOLS = [
  'codex',
  'claude',
  'gemini',
  'opencode',
  'grok',
  'antigravity',
] as const;

/** Applies the proxy agent profiles the managed T3 instances launch from
 * (codex-proxy.ts refuses to start with a missing or stale profile). Workers
 * apply the same profiles from a pinned deployment; the manager's checkout is
 * the human's working tree, so only the workstation sources must be clean
 * (the `agents apply` owner enforces that) and nothing else is touched.
 */
export async function managerAgentProfiles(
  id: string,
  workspace: string,
  run: Runner
): Promise<Check[]> {
  for (const tool of PROFILE_TOOLS) {
    const result = await run(
      [
        'mise',
        'exec',
        '--locked',
        'bun',
        '--',
        'bun',
        'packages/workstation/cli/internal.ts',
        '--json',
        '--yes',
        '--non-interactive',
        'agents',
        'apply',
        '--node',
        id,
        '--tool',
        tool,
        '--profile',
        'proxy',
      ],
      { cwd: workspace, timeoutMs: 120_000 }
    );
    if (!result.ok)
      return [
        {
          id: 'configuration:apply',
          status: 'fail',
          summary: 'MANAGER_AGENT_PROFILES_FAILED',
          remedy: {
            action: `Run bun run personal workstation agents apply --yes --node ${id} --tool ${tool} --profile proxy on the manager and review the result; commit or stash edits under packages/workstation first.`,
          },
        },
      ];
  }
  return [
    {
      id: 'configuration:apply',
      status: 'pass',
      summary: `The manager has the same proxy agent profiles as every worker (${PROFILE_TOOLS.join(', ')}).`,
    },
  ];
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
