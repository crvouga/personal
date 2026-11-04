import { record } from '../../fleet/src/config';
import { ReleaseError } from './release-error';
import { withUserpassSession } from './release-userpass';

function tokenField(value: unknown, key: string): string | null {
  if (!record(value) || !record(value['data'])) return null;
  const inner = value['data'];
  const fields = record(inner['data']) ? inner['data'] : inner;
  return typeof fields[key] === 'string' && fields[key].trim()
    ? fields[key]
    : null;
}

export async function publishingToken(
  env = process.env,
  login = false
): Promise<string> {
  if (login || env['PERSONAL_VAULT_PASSWORD_FILE'])
    return userpassCredential(env);
  const direct = env['NODE_AUTH_TOKEN'] || env['NPM_TOKEN'];
  if (direct) return direct;
  return userpassCredential(env);
}

async function userpassCredential(env: NodeJS.ProcessEnv): Promise<string> {
  const { address, path, key } = vaultSettings(env);
  return withUserpassSession(env, (session) =>
    tokenFromApi(address, path, key, session)
  );
}

function vaultSettings(env: NodeJS.ProcessEnv) {
  return {
    key: env['PERSONAL_NPM_TOKEN_KEY'] ?? 'NPM_TOKEN',
    path: env['PERSONAL_NPM_VAULT_PATH'] ?? 'secret/data/personal/prd',
    address: env['VAULT_ADDR'] ?? 'https://vault.chrisvouga.dev',
  };
}

async function tokenFromApi(
  address: string,
  path: string,
  key: string,
  token: string
): Promise<string> {
  const url = new URL(address);
  if (url.protocol !== 'https:' || !/^[a-zA-Z0-9_/-]+$/.test(path))
    throw new ReleaseError(
      'Vault reads require an HTTPS address and a valid KV path.'
    );
  const response = await fetch(new URL(`/v1/${path}`, url), {
    headers: { 'X-Vault-Token': token },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok)
    throw new ReleaseError(
      'Vault denied the npm credential read or is unavailable. Check the existing scoped session; do not change policy outside OpenTofu.'
    );
  const value = tokenField(await response.json(), key);
  if (!value)
    throw new ReleaseError(
      'Vault login succeeded, but the configured document has no npm publishing token field. Select an existing field with PERSONAL_NPM_TOKEN_KEY, or run bootstrap with --npm-login for initial account authorization. Recovery codes are not publishing credentials; secret updates remain OpenTofu-owned.'
    );
  return value;
}
