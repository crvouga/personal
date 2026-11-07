import { providerFailureCode } from './provider-errors';
import { verifyRoundTrip } from './round-trip';
import { proxyKey } from './secrets';
import type { Check } from '../../../../fleet/src/types';
import { registry, type Selection } from './registry';
import { verifyProvider } from './verify';

/** Uses the selected gateway credential in this node's noninteractive environment.
 * Authentication/inference evidence does not certify native clients or paired T3.
 */
export async function verifyFleetProviders(node: string): Promise<Check[]> {
  const checks: Check[] = [];
  let key: string;
  try {
    key = await proxyKey();
  } catch {
    return Object.keys(registry.proxy.routes).map((provider) => ({
      id: `provider:${provider}:authentication`,
      status: 'fail',
      summary: 'PROVIDER_UNATTENDED_CREDENTIAL_REQUIRED',
      remedy: {
        action:
          'Restore this node’s existing Vault authorization and renewal. No model requests or native OAuth login were attempted.',
      },
    }));
  }

  for (const [provider, route] of Object.entries(registry.proxy.routes)) {
    const selection: Selection = {
      node,
      profile: 'proxy',
      tool: (route.native ?? route.harness) as Selection['tool'],
      model: route.model,
    };
    try {
      const evidence = await verifyProvider(selection, true, key);
      await verifyRoundTrip(route.model, key);
      checks.push({
        id: `provider:${provider}:inference`,
        status: evidence.inference === 'pass' ? 'pass' : 'fail',
        summary:
          'Gateway authentication, bounded inference, completed streaming and safe echo tool round trip verified from node environment. Native CLI/T3 execution is separate.',
      });
    } catch (error) {
      checks.push({
        id: `provider:${provider}:inference`,
        status: 'fail',
        summary: providerFailureCode(error),
        remedy: {
          action: `Verify unattended Vault access and the declared ${provider} model on the singleton gateway. Preserve OAuth state; do not log native auth on proxy clients.`,
        },
      });
    }
  }
  return checks;
}
