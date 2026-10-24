import { test, expect } from 'bun:test';
import { sourceSchema } from '../domain/config.ts';
import { MemorySecrets } from '../testing/fakes.ts';
import { finishOAuth, startOAuth, refreshOAuth } from './oauth.ts';
test('OAuth PKCE validates callback/state/mailbox, stores tokens securely and rejects replay', async () => {
  const secrets = new MemorySecrets();
  const source = sourceSchema.parse({
    id: 'gmail',
    kind: 'gmail',
    identity: 'alice@example.test',
    clientId: 'synthetic',
    tokenRef: 'oauth/gmail',
  });
  let exchangeBody = '';
  const fakeFetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
    if (String(url).includes('/token')) {
      exchangeBody = String(init?.body);
      return Response.json({
        access_token: 'ACCESS_CANARY',
        refresh_token: 'REFRESH_CANARY',
        expires_in: 3600,
        scope: 'https://www.googleapis.com/auth/gmail.readonly',
      });
    }
    return Response.json({ emailAddress: 'alice@example.test' });
  }) as typeof fetch;
  const auth = new URL(
    await startOAuth({
      source,
      secrets,
      redirect: 'http://127.0.0.1:43210/callback',
    })
  );
  expect(auth.searchParams.get('code_challenge_method')).toBe('S256');
  const state = auth.searchParams.get('state');
  const callback = `http://127.0.0.1:43210/callback?state=${state}&code=CODE_CANARY`;
  await expect(
    finishOAuth({
      source,
      secrets,
      callback: callback.replace(String(state), 'wrong'),
      fetch: fakeFetch,
    })
  ).rejects.toThrow('invalid-input');
  expect(exchangeBody).toBe('');
  await finishOAuth({ source, secrets, callback, fetch: fakeFetch });
  expect(exchangeBody).toContain('code_verifier=');
  expect(
    (await secrets.getRequired('oauth/gmail')).readSecretValue()
  ).toContain('REFRESH_CANARY');
  expect(
    JSON.stringify(await secrets.getRequired('oauth/gmail'))
  ).not.toContain('REFRESH_CANARY');
  await expect(
    finishOAuth({ source, secrets, callback, fetch: fakeFetch })
  ).rejects.toThrow('expired-connection');
});
test('wrong selected mailbox is refused before storing authorization', async () => {
  const secrets = new MemorySecrets();
  const source = sourceSchema.parse({
    id: 'gmail',
    kind: 'gmail',
    identity: 'alice@example.test',
    clientId: 'synthetic',
    tokenRef: 'oauth/gmail',
  });
  const auth = new URL(
    await startOAuth({
      source,
      secrets,
      redirect: 'http://127.0.0.1:43210/callback',
    })
  );
  const fakeFetch = (async (url: RequestInfo | URL) =>
    String(url).includes('/token')
      ? Response.json({
          access_token: 'ACCESS_CANARY',
          scope: 'https://www.googleapis.com/auth/gmail.readonly',
        })
      : Response.json({ emailAddress: 'other@example.test' })) as typeof fetch;
  await expect(
    finishOAuth({
      source,
      secrets,
      callback: `http://127.0.0.1:43210/callback?state=${auth.searchParams.get('state')}&code=synthetic`,
      fetch: fakeFetch,
    })
  ).rejects.toThrow('conflict');
  expect(await secrets.getOptional('oauth/gmail')).toBeNull();
});
test('revoked refresh credentials produce explicit expired connection', async () => {
  const secrets = new MemorySecrets();
  const source = sourceSchema.parse({
    id: 'gmail',
    kind: 'gmail',
    identity: 'alice@example.test',
    clientId: 'synthetic',
    tokenRef: 'oauth/gmail',
  });
  await secrets.setSecret(
    'oauth/gmail',
    JSON.stringify({
      accessToken: 'ACCESS_CANARY',
      refreshToken: 'REFRESH_CANARY',
      expiresAt: 0,
      scopes: ['https://www.googleapis.com/auth/gmail.readonly'],
    })
  );
  const fakeFetch = (async (_input: RequestInfo | URL) =>
    new Response('SENSITIVE_PROVIDER_BODY', { status: 400 })) as typeof fetch;
  await expect(
    refreshOAuth({ source, secrets, fetch: fakeFetch })
  ).rejects.toThrow('expired-connection');
});

test('insufficient stored scopes are rejected before discovery or token refresh', async () => {
  const secrets = new MemorySecrets();
  const source = sourceSchema.parse({
    id: 'mail',
    kind: 'gmail',
    tokenRef: 'oauth/mail',
  });
  await secrets.setSecret(
    'oauth/mail',
    JSON.stringify({
      accessToken: 'ACCESS_CANARY',
      expiresAt: Date.now() + 3600000,
      scopes: ['gmail.metadata'],
    })
  );
  const fakeFetch = (async (_input: RequestInfo | URL) => {
    throw new Error('network must not be called');
  }) as unknown as typeof fetch;
  await expect(
    refreshOAuth({ source, secrets, fetch: fakeFetch })
  ).rejects.toThrow('insufficient-scope');
});
