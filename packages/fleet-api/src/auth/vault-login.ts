import type { Logger } from '@pkgs/logger';

export const USERNAME_PATTERN = /^[A-Za-z0-9_.-]{1,64}$/;
const MAX_PASSWORD_LENGTH = 512;
const VAULT_TIMEOUT_MS = 5000;
const ADMIN_POLICY = 'admin';

export interface VaultLoginDeps {
  readonly vaultAddr: string | null;
  readonly fetch: typeof fetch;
  readonly log: Logger;
  readonly timeoutMs?: number;
}

interface Issued {
  readonly token: string | null;
  readonly policies: readonly string[] | null;
}

/** What Vault issued. The token is picked out even when the policies are unusable, so it can be revoked. */
function issuedBy(body: unknown): Issued {
  const auth =
    typeof body === 'object' && body !== null
      ? (body as { auth?: unknown }).auth
      : null;
  if (typeof auth !== 'object' || auth === null)
    return { token: null, policies: null };
  const { policies, client_token: token } = auth as {
    policies?: unknown;
    client_token?: unknown;
  };
  return {
    token: typeof token === 'string' ? token : null,
    policies: Array.isArray(policies)
      ? policies.filter((p): p is string => typeof p === 'string')
      : null,
  };
}

async function revoke(deps: VaultLoginDeps, token: string): Promise<void> {
  try {
    const res = await deps.fetch(
      `${deps.vaultAddr}/v1/auth/token/revoke-self`,
      {
        method: 'POST',
        headers: { 'X-Vault-Token': token },
        redirect: 'manual',
        signal: AbortSignal.timeout(deps.timeoutMs ?? VAULT_TIMEOUT_MS),
      }
    );
    if (!res.ok)
      deps.log.error('vault token revoke failed', { status: res.status });
  } catch (err: unknown) {
    deps.log.error('vault token revoke failed', { error: String(err) });
  }
}

async function requestLogin(
  deps: VaultLoginDeps,
  username: string,
  password: string
): Promise<unknown> {
  const url = `${deps.vaultAddr}/v1/auth/userpass/login/${encodeURIComponent(username)}`;
  const res = await deps.fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
    redirect: 'manual',
    signal: AbortSignal.timeout(deps.timeoutMs ?? VAULT_TIMEOUT_MS),
  });
  if (!res.ok) {
    deps.log.info('vault login refused', { status: res.status });
    return null;
  }
  return res.json();
}

/**
 * Checks a person's password against Vault userpass. True only for a user
 * whose policies include `admin`. The Vault token is revoked immediately and
 * never kept. The password is never logged.
 */
export async function vaultAdminLogin(
  deps: VaultLoginDeps,
  username: string,
  password: string
): Promise<boolean> {
  if (deps.vaultAddr === null) return false;
  if (!USERNAME_PATTERN.test(username)) return false;
  if (password.length === 0 || password.length > MAX_PASSWORD_LENGTH)
    return false;
  let body: unknown;
  try {
    body = await requestLogin(deps, username, password);
  } catch (err: unknown) {
    deps.log.error('vault login failed', { error: String(err) });
    return false;
  }
  const { token, policies } = issuedBy(body);
  if (token !== null) await revoke(deps, token);
  if (policies === null || !policies.includes(ADMIN_POLICY)) {
    deps.log.info('login refused: not an admin', { username });
    return false;
  }
  return true;
}
