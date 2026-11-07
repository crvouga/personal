import { VaultSecretStore } from '@pkgs/secret-store';
import { VaultCli } from '@pkgs/vault';
import { resolveVaultConfig } from '../vault-config';
import { privateHub } from '../../../../fleet/src/monitoring/beszel';
import type { HubRequest } from '../../../../fleet/src/monitoring/enroll';
import { record } from '../../../../fleet/src/config';

/** Read existing Vault authorization only. This never creates credentials or
 * changes Vault policy. The normal Beszel account must have fleet-node access.
 */
export async function hubAccess(
  hub: string
): Promise<{ userId: string; request: HubRequest }> {
  const url = privateHub(hub);
  const vault = resolveVaultConfig();
  const store = new VaultSecretStore({
    ...vault,
    token: new VaultCli({ addr: vault.addr }).resolveToken().token,
  });
  const secret = await store.getOptional('BESZEL_FLEET_AUTH');
  if (!secret) throw new Error('BESZEL_ACCOUNT_REQUIRED');
  const credentials: unknown = JSON.parse(secret.readSecretValue());
  if (
    !record(credentials) ||
    typeof credentials['identity'] !== 'string' ||
    typeof credentials['password'] !== 'string'
  )
    throw new Error('BESZEL_ACCOUNT_INVALID');
  const login = await call(
    url,
    '/api/collections/users/auth-with-password',
    '',
    { identity: credentials['identity'], password: credentials['password'] }
  );
  if (
    !record(login) ||
    typeof login['token'] !== 'string' ||
    !record(login['record']) ||
    typeof login['record']['id'] !== 'string'
  )
    throw new Error('BESZEL_AUTH_REQUIRED');
  const token = login['token'];
  return {
    userId: login['record']['id'],
    request: (path, body) => call(url, path, token, body),
  };
}
async function call(
  url: string,
  path: string,
  token: string,
  body?: object
): Promise<unknown> {
  if (!path.startsWith('/api/')) throw new Error('BESZEL_API_PATH');
  const response = await fetch(`${url}${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { Authorization: token, 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
    redirect: 'error',
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok)
    throw new Error(
      response.status === 401 || response.status === 403
        ? 'BESZEL_AUTH_REQUIRED'
        : 'BESZEL_API_UNAVAILABLE'
    );
  return response.json() as Promise<unknown>;
}
