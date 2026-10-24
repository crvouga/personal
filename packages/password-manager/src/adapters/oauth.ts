import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import type { SecretStore } from '@pkgs/secret-store';
import type { SourceConfig } from '../domain/config.ts';
import { ManagerError } from '../domain/errors.ts';
import { validateSourceIdentity } from './source-identity.ts';
import { assertMailScopes } from './oauth-scopes.ts';
import { boundedResponse } from './http.ts';
export interface OAuthToken {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  scopes: string[];
}
export interface OAuthPending {
  state: string;
  verifier: string;
  redirect: string;
  expiresAt: number;
}
export function oauthProvider(source: SourceConfig) {
  if (source.kind === 'gmail')
    return {
      authorization: 'https://accounts.google.com/o/oauth2/v2/auth',
      token: 'https://oauth2.googleapis.com/token',
      scopes: ['https://www.googleapis.com/auth/gmail.readonly'],
    };
  if (source.kind === 'microsoft')
    return {
      authorization: `https://login.microsoftonline.com/${source.tenant}/oauth2/v2.0/authorize`,
      token: `https://login.microsoftonline.com/${source.tenant}/oauth2/v2.0/token`,
      scopes: [
        'offline_access',
        'https://graph.microsoft.com/Mail.ReadBasic',
        'https://graph.microsoft.com/User.Read',
      ],
    };
  throw new ManagerError('invalid-config');
}
export async function startOAuth(input: {
  source: SourceConfig;
  secrets: SecretStore;
  redirect: string;
}): Promise<string> {
  const { source, secrets, redirect } = input;
  if (!source.clientId || !source.tokenRef)
    throw new ManagerError('invalid-config');
  const callback = new URL(redirect);
  if (callback.hostname !== '127.0.0.1' || callback.protocol !== 'http:')
    throw new ManagerError('invalid-input');
  const pending: OAuthPending = {
    state: randomBytes(32).toString('base64url'),
    verifier: randomBytes(48).toString('base64url'),
    redirect,
    expiresAt: Date.now() + 10 * 60_000,
  };
  await secrets.setSecret(
    `oauth-pending/${source.id}`,
    JSON.stringify(pending)
  );
  const provider = oauthProvider(source);
  const params = new URLSearchParams({
    client_id: source.clientId,
    redirect_uri: redirect,
    response_type: 'code',
    scope: provider.scopes.join(' '),
    state: pending.state,
    code_challenge: createHash('sha256')
      .update(pending.verifier)
      .digest('base64url'),
    code_challenge_method: 'S256',
    ...(source.kind === 'gmail'
      ? { access_type: 'offline', prompt: 'consent' }
      : {}),
  });
  return `${provider.authorization}?${params}`;
}
export async function finishOAuth(input: {
  source: SourceConfig;
  secrets: SecretStore;
  callback: string;
  fetch: typeof fetch;
}): Promise<void> {
  const pending = JSON.parse(
    (
      await input.secrets.getRequired(`oauth-pending/${input.source.id}`)
    ).readSecretValue()
  ) as OAuthPending;
  const url = new URL(input.callback);
  if (
    url.origin + url.pathname !== pending.redirect ||
    Date.now() > pending.expiresAt
  )
    throw new ManagerError('expired-connection');
  const returned = Buffer.from(url.searchParams.get('state') ?? '');
  const expected = Buffer.from(pending.state);
  if (
    returned.length !== expected.length ||
    !timingSafeEqual(returned, expected)
  )
    throw new ManagerError('invalid-input');
  if (!url.searchParams.get('code') || url.searchParams.has('error'))
    throw new ManagerError('not-authenticated');
  const token = await exchange({
    ...input,
    fields: {
      grant_type: 'authorization_code',
      code: url.searchParams.get('code')!,
      redirect_uri: pending.redirect,
      code_verifier: pending.verifier,
    },
  });
  await validateSourceIdentity({
    source: input.source,
    token: token.accessToken,
    fetch: input.fetch,
  });
  await input.secrets.setSecret(input.source.tokenRef!, JSON.stringify(token));
  await input.secrets.setSecret(
    `oauth-pending/${input.source.id}`,
    JSON.stringify({ ...pending, expiresAt: 0, verifier: '' })
  );
}
export async function refreshOAuth(input: {
  source: SourceConfig;
  secrets: SecretStore;
  fetch: typeof fetch;
}): Promise<void> {
  const ref = input.source.tokenRef;
  if (!ref) throw new ManagerError('not-authenticated');
  const token = JSON.parse(
    (await input.secrets.getRequired(ref)).readSecretValue()
  ) as OAuthToken;
  assertMailScopes(input.source, token.scopes);
  if (token.expiresAt > Date.now() + 60_000) return;
  if (!token.refreshToken) throw new ManagerError('expired-connection');
  const updated = await exchange({
    ...input,
    fields: { grant_type: 'refresh_token', refresh_token: token.refreshToken },
  });
  await validateSourceIdentity({
    source: input.source,
    token: updated.accessToken,
    fetch: input.fetch,
  });
  await input.secrets.setSecret(
    ref,
    JSON.stringify({
      ...updated,
      refreshToken: updated.refreshToken || token.refreshToken,
    })
  );
}
async function exchange(input: {
  source: SourceConfig;
  secrets: SecretStore;
  fetch: typeof fetch;
  fields: Record<string, string>;
}): Promise<OAuthToken> {
  const provider = oauthProvider(input.source);
  const secret = input.source.clientSecretRef
    ? (
        await input.secrets.getRequired(input.source.clientSecretRef)
      ).readSecretValue()
    : null;
  const params = new URLSearchParams({
    client_id: input.source.clientId ?? '',
    ...input.fields,
    ...(secret ? { client_secret: secret } : {}),
  });
  const response = await input.fetch(provider.token, {
    method: 'POST',
    redirect: 'error',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params,
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new ManagerError('expired-connection');
  const data = await boundedResponse<{
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
  }>(response);
  if (!data.access_token) throw new ManagerError('not-authenticated');
  const scopes = validateScopes(data.scope ?? '', provider.scopes);
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? '',
    expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
    scopes,
  };
}

function validateScopes(scope: string, expected: string[]): string[] {
  const scopes = scope ? scope.split(' ') : expected;
  const required = expected.filter((s) => s !== 'offline_access');
  if (
    scopes.some(Boolean) &&
    required.some(
      (s) => !scopes.includes(s) && !scopes.includes(s.split('/').pop()!)
    )
  ) {
    throw new ManagerError('insufficient-scope');
  }
  return scopes;
}
