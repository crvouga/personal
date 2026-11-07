import { record } from './config';
import type { Check, Runner } from './types';

/** The existing proxy owner performs singleton/state/provenance checks before
 * starting an owned stopped unit. Routine sync cannot upgrade or restore it.
 */
export async function convergeProxy(
  node: string,
  revision: string,
  run: Runner
): Promise<Check[]> {
  const result = await run(
    [
      'python3',
      '-B',
      'packages/cliproxy-fleet/scripts/fleet_sync.py',
      '--definition',
      'packages/fleet/definition.json',
      '--node',
      node,
      '--revision',
      revision,
      '--apply',
    ],
    { timeoutMs: 180_000 }
  );
  try {
    const data: unknown = JSON.parse(result.stdout);
    if (
      !record(data) ||
      data['version'] !== 1 ||
      !Array.isArray(data['phases']) ||
      !data['phases'].length
    )
      throw new Error();
    return data['phases'].map((phase): Check => {
      if (
        !record(phase) ||
        typeof phase['code'] !== 'string' ||
        !/^PROXY_[A-Z0-9_]+$/.test(phase['code'])
      )
        throw new Error();
      return {
        id: `proxy:${phase['code'].slice(6).toLowerCase().replaceAll('_', '-')}`,
        status: phase['status'] === 'unchanged' ? 'pass' : 'fail',
        summary: phase['code'],
        remedy: {
          action:
            'Inspect the singleton proxy owner with its existing audit/recovery runbook. Revision changes require maintenance; missing state requires fencing and encrypted recovery, never a second identity.',
        },
      };
    });
  } catch {
    return [
      {
        id: 'proxy:configuration',
        status: 'fail',
        summary: 'PROXY_RECONCILE_UNVERIFIED',
        remedy: {
          action:
            'Inspect the existing CLIProxyAPI owner and its deployment manifest; runtime data and credentials were not copied.',
        },
      },
    ];
  }
}
