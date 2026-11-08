import { runAnsible } from '../platform/ansible';
import { resolve } from 'node:path';
import { record } from '../../../../fleet/src/config';
import type { Check, Runner } from '../../../../fleet/src/types';
import {
  PUBLIC_HUB_URL,
  privateHub,
} from '../../../../fleet/src/monitoring/beszel';
import { resolveVaultConfig } from '../vault-config';

export async function applyHub(
  root: string,
  url: string,
  run: Runner
): Promise<Check[]> {
  const hub = privateHub(url);
  const tunnel = await tunnelToken(run);
  const result = await runAnsible(run, 'hub.yml', {
    cwd: resolve(root, 'packages/workstation/monitoring'),
    input: JSON.stringify({
      beszel_hub_url: hub,
      beszel_public_url: PUBLIC_HUB_URL,
      ...(tunnel ? { beszel_tunnel_token: tunnel } : {}),
    }),
    timeoutMs: 300_000,
  });
  if (!result.ok)
    return failure(
      'BESZEL_HUB_INSTALLATION_INCOMPLETE',
      'Inspect Docker/Compose prerequisites, image conflicts, permissions and disk space. Existing data is never deleted.'
    );
  const status = await run(['tailscale', 'serve', 'status', '--json']);
  if (!status.ok)
    return failure(
      'BESZEL_PRIVATE_ROUTE_UNVERIFIED',
      'Inspect Tailscale Serve permission and existing private routes before retry.'
    );
  const route = inspectRoute(status.stdout, hub);
  if (Array.isArray(route)) return route;
  const configured = route;

  if (
    !configured &&
    !(
      await run(
        [
          'sudo',
          '-n',
          'tailscale',
          'serve',
          '--bg',
          '--https=8443',
          'http://127.0.0.1:8090',
        ],
        { timeoutMs: 20_000 }
      )
    ).ok
  )
    return failure(
      'BESZEL_PRIVATE_ROUTE_REQUIRED',
      'Authorize the existing Tailscale HTTPS capability; no tailnet policy or public ingress is changed.'
    );
  const verified = await run(['tailscale', 'serve', 'status', '--json']);
  if (!verified.ok || inspectRoute(verified.stdout, hub) !== true)
    return failure(
      'BESZEL_PRIVATE_ROUTE_UNVERIFIED',
      'The requested route was not independently observed after application. Inspect Serve permissions and configuration; installer success is insufficient.'
    );
  return [
    {
      id: 'beszel:hub',
      status: 'pass',
      summary:
        'Pinned hub is locally healthy and a private Serve route is configured; authentication and remote metrics are separate checks.',
    },
    tunnel
      ? {
          id: 'beszel:public-endpoint',
          status: 'pass',
          summary: `Cloudflare connector for ${PUBLIC_HUB_URL} was started from the Vault credential.`,
        }
      : {
          id: 'beszel:public-endpoint',
          status: 'warn',
          summary: 'BESZEL_TUNNEL_CREDENTIAL_UNAVAILABLE',
          remedy: {
            action: `Apply the OpenTofu foundation and vault roots, then ensure this node's worker token (policy beszel-hub-read) is logged in and rerun fleet-sync. The private dashboard is unaffected; ${PUBLIC_HUB_URL} stays offline until then.`,
          },
        },
  ];
}

/** The hub's own Vault login reads the isolated connector document. Null when
 * the credential or this node's authorization is not provisioned yet.
 */
async function tunnelToken(run: Runner): Promise<string | null> {
  const vault = resolveVaultConfig();
  const read = await run([
    'vault',
    'kv',
    'get',
    `-address=${vault.addr}`,
    `-mount=${vault.mount}`,
    '-field=TUNNEL_TOKEN',
    'beszel/tunnel',
  ]);
  const value = read.ok ? read.stdout.trim() : '';
  return value.length > 0 ? value : null;
}
function failure(code: string, action: string): Check[] {
  return [
    { id: 'beszel:hub', status: 'fail', summary: code, remedy: { action } },
  ];
}

export function inspectRoute(
  output: string,
  hub: string,
  target = { port: '8443', proxy: 'http://127.0.0.1:8090' }
): boolean | Check[] {
  let configured = false;
  try {
    const value: unknown = JSON.parse(output);
    if (!record(value)) throw new Error();
    if (publicOrConflictingTcp(value, hub, target.port))
      return failure(
        'BESZEL_PRIVATE_ROUTE_CONFLICT',
        'Existing Funnel/public or TCP routing conflicts with private Beszel access. Review the source-owned route; do not reset Serve.'
      );
    const web = value['Web'];
    if (record(web)) {
      const entry = web[new URL(hub).hostname + ':' + target.port];
      if (entry !== undefined) {
        if (!expectedHandler(entry, target.proxy))
          return failure(
            'BESZEL_PRIVATE_ROUTE_CONFLICT',
            'Port 8443 is owned by a different Tailscale Serve handler. Review a source-controlled route migration; do not reset Serve.'
          );
        configured = true;
      }
    }
  } catch {
    return failure(
      'BESZEL_PRIVATE_ROUTE_UNVERIFIED',
      'Review Tailscale Serve status without exposing raw configuration.'
    );
  }
  return configured;
}

function publicOrConflictingTcp(
  value: Record<string, unknown>,
  hub: string,
  port: string
): boolean {
  const funnel = value['AllowFunnel'];
  if (record(funnel) && funnel[new URL(hub).hostname + ':' + port] === true)
    return true;
  const tcp = value['TCP'];
  if (!record(tcp) || tcp[port] === undefined) return false;
  return !record(tcp[port]) || tcp[port]['HTTPS'] !== true;
}

function expectedHandler(entry: unknown, proxy: string): boolean {
  return (
    record(entry) &&
    record(entry['Handlers']) &&
    record(entry['Handlers']['/']) &&
    entry['Handlers']['/']['Proxy'] === proxy
  );
}
