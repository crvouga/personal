import { record } from './config';
import type { Check, Runner } from './types';

/** The proxy runs only on the manager, which performs singleton/state/provenance
 * checks before starting a stopped install; on a worker this verifies the
 * client-only role. Routine sync cannot upgrade or restore it.
 */
export async function convergeProxy(
  node: string,
  revision: string,
  run: Runner,
  options: { apply?: boolean; cwd?: string } = {}
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
      ...(options.apply === false ? [] : ['--apply']),
    ],
    {
      timeoutMs: 180_000,
      ...(options.cwd ? { cwd: options.cwd } : {}),
    }
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
            'The proxy runs only on the manager. Inspect it there with its audit/recovery runbook; revision changes require maintenance, and missing state requires fencing and encrypted recovery, never a second identity.',
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
            'Inspect the CLIProxyAPI install on the manager and its deployment manifest; runtime data and credentials were not copied.',
        },
      },
    ];
  }
}
