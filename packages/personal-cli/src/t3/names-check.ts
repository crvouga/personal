import { desired, nodeId, paths } from './desired';
import { conformT3Names } from './names';
import type { Check } from '../../../fleet/src/types';

/** Fleet check: this machine's T3 lists every provider under the convention. */
export async function providerNames(
  id: string,
  workspace: string,
  apply: boolean,
  t3Home?: string
): Promise<Check> {
  try {
    const target = paths(t3Home ? { t3Home } : {}, workspace);
    const managed = Object.keys(
      await desired(target.definition, workspace, nodeId(id))
    );
    const { changed } = await conformT3Names(target.settings, managed, {
      apply,
    });
    return changed && !apply
      ? {
          id: 't3:provider-names',
          status: 'warn',
          summary: 'T3_PROVIDER_NAMES_PENDING',
          remedy: {
            action:
              'fleet-sync renames these providers to the convention when applied.',
          },
        }
      : {
          id: 't3:provider-names',
          status: 'pass',
          summary:
            'Every T3 provider is named "<Provider> CLI Proxy" or "<Provider> <account email>".',
        };
  } catch {
    return {
      id: 't3:provider-names',
      status: 'fail',
      summary: 'T3_PROVIDER_NAMES_UNVERIFIED',
      remedy: {
        action:
          'T3 settings were unreadable or changed during the rename. Rerun fleet-sync; only provider display names are written.',
      },
    };
  }
}
