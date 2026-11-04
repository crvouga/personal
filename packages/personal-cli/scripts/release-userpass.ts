import { input, password } from '@inquirer/prompts';
import { readFile } from 'node:fs/promises';
import { record } from '../../fleet/src/config';
import { ReleaseError } from './release-error';

export async function withUserpassSession<T>(
  env: NodeJS.ProcessEnv,
  operation: (token: string) => Promise<T>,
  request: typeof fetch = fetch
): Promise<T> {
  const address = vaultAddress(env);
  const credentials = await loginCredentials(env);
  const response = await request(
    new URL(
      `/v1/auth/userpass/login/${encodeURIComponent(credentials.username)}`,
      address
    ),
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: credentials.password }),
      signal: AbortSignal.timeout(20_000),
    }
  );
  if (!response.ok)
    throw new ReleaseError(
      'Vault username/password login was rejected or is unavailable. No credentials were saved.'
    );
  const token = sessionToken(await response.json());
  try {
    return await operation(token);
  } finally {
    const revoked = await request(
      new URL('/v1/auth/token/revoke-self', address),
      {
        method: 'POST',
        headers: { 'X-Vault-Token': token },
        signal: AbortSignal.timeout(20_000),
      }
    )
      .then((value) => value.ok)
      .catch(() => false);
    if (!revoked)
      process.stderr.write(
        'Temporary Vault session could not be revoked; it was not saved and will expire under its existing policy.\n'
      );
  }
}

function vaultAddress(env: NodeJS.ProcessEnv): URL {
  const address = new URL(env['VAULT_ADDR'] ?? 'https://vault.chrisvouga.dev');
  if (address.protocol !== 'https:' || address.username || address.password)
    throw new ReleaseError(
      'Vault username/password login requires an HTTPS address without embedded credentials.'
    );
  return address;
}

function sessionToken(result: unknown): string {
  const token =
    record(result) && record(result['auth'])
      ? result['auth']['client_token']
      : null;
  if (typeof token !== 'string' || !token)
    throw new ReleaseError('Vault login returned no session.');
  return token;
}

async function loginCredentials(env: NodeJS.ProcessEnv) {
  const file = env['PERSONAL_VAULT_PASSWORD_FILE'];
  const username = env['PERSONAL_VAULT_USERNAME'] ?? 'crvouga';
  if (file)
    return {
      username,
      password: (await readFile(file, 'utf8')).replace(/\r?\n$/, ''),
    };
  if (!process.stdin.isTTY || !process.stderr.isTTY || env['CI'])
    throw new ReleaseError(
      'Vault password login needs a terminal, or PERSONAL_VAULT_USERNAME and a private PERSONAL_VAULT_PASSWORD_FILE. CI uses its existing OIDC session instead.'
    );
  return {
    username: await input({
      message: 'Vault username',
      default: username,
      required: true,
    }),
    password: await password({
      message: 'Vault password',
      mask: '*',
      validate: (value) => Boolean(value) || 'Enter your Vault password.',
    }),
  };
}
