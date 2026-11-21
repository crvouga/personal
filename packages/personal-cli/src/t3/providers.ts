import type { Check } from '../../../fleet/src/types';
import { desired, nodeId, paths } from './desired';
import { reconcileT3 } from './reconcile';

/** Every machine's T3 offers the same declared provider instances. T3 watches
 * settings.json, so reconciling it applies new or changed instances to new
 * sessions without restarting the app or ending active turns. The ownership-
 * safe engine preserves unrelated settings and unmanaged instances; an
 * existing unowned instance of the same ID is reported, never overwritten.
 *
 * Providers must not be staged through the administrator policy: a policy is
 * read only at startup, so every provider change there would need a restart.
 */
export async function t3Providers(
  id: string,
  workspace: string,
  apply: boolean,
  options: { t3Home?: string; definition?: string } = {}
): Promise<Check> {
  const remedy = {
    action:
      'Run personal t3-apply --dry-run on the machine and review any conflicting instance; adopt it with t3-apply --import ID only if it should be managed.',
  };
  try {
    const target = {
      ...paths(options.t3Home ? { t3Home: options.t3Home } : {}, workspace),
      ...(options.definition ? { definition: options.definition } : {}),
    };
    const instances = await desired(target.definition, workspace, nodeId(id));
    const plan = await reconcileT3(target, instances, { apply: false });
    const result =
      apply && plan.ok && plan.changed
        ? await reconcileT3(target, instances, {
            apply: true,
            planHash: plan.planHash,
          })
        : plan;
    return outcome(result, apply, remedy);
  } catch {
    return failure('T3_PROVIDERS_UNVERIFIED', remedy);
  }
}

type Remedy = { action: string };

function outcome(
  result: Awaited<ReturnType<typeof reconcileT3>>,
  apply: boolean,
  remedy: Remedy
): Check {
  if (!result.ok) return failure('T3_PROVIDER_CONFLICT', remedy);
  if (result.changed && !apply)
    return {
      id: 't3:providers',
      status: 'warn',
      summary: 'T3_PROVIDERS_PENDING',
      remedy,
    };
  return {
    id: 't3:providers',
    status: 'pass',
    summary:
      'T3 offers the declared managed provider instances; changes apply without a restart.',
  };
}

function failure(summary: string, remedy: Remedy): Check {
  return { id: 't3:providers', status: 'fail', summary, remedy };
}
