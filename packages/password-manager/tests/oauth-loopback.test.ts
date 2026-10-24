import { test } from 'node:test';
import assert from 'node:assert/strict';
import { connectOAuth } from '../src/adapters/oauth-loopback.ts';
import { sourceSchema } from '../src/domain/config.ts';
import { MemorySecrets } from '../src/testing/fakes.ts';
const source = sourceSchema.parse({
  id: 'mail',
  kind: 'gmail',
  clientId: 'synthetic',
  identity: 'alice@example.test',
  tokenRef: 'oauth/mail',
});
const providerFetch = (async (input: RequestInfo | URL) =>
  String(input).includes('/token')
    ? Response.json({
        access_token: 'ACCESS_CANARY',
        refresh_token: 'REFRESH_CANARY',
        scope: 'https://www.googleapis.com/auth/gmail.readonly',
      })
    : Response.json({ emailAddress: 'alice@example.test' })) as typeof fetch;
void test('real loopback callback rejects invalid state, accepts the selected account and closes after consent', async () => {
  const secrets = new MemorySecrets();
  let callback = '';
  await connectOAuth({
    source,
    secrets,
    fetch: providerFetch,
    open: async (url) => {
      const auth = new URL(url);
      const redirect = new URL(auth.searchParams.get('redirect_uri')!);
      assert.equal(redirect.hostname, '127.0.0.1');
      const invalid = new URL(redirect);
      invalid.searchParams.set('state', 'WRONG');
      invalid.searchParams.set('code', 'CODE_CANARY');
      assert.equal((await fetch(invalid)).status, 400);
      redirect.searchParams.set('state', auth.searchParams.get('state')!);
      redirect.searchParams.set('code', 'CODE_CANARY');
      callback = redirect.href;
      assert.equal((await fetch(redirect)).status, 200);
    },
  });
  assert.ok(await secrets.getOptional('oauth/mail'));
  await assert.rejects(fetch(callback));
});
void test('cancelling consent closes the loopback listener and preserves an actionable cancelled outcome', async () => {
  const secrets = new MemorySecrets();
  const controller = new AbortController();
  let callback = '';
  await assert.rejects(
    connectOAuth({
      source,
      secrets,
      fetch: providerFetch,
      signal: controller.signal,
      open: async (url) => {
        callback = new URL(url).searchParams.get('redirect_uri')!;
        controller.abort();
      },
    }),
    /cancelled/
  );
  assert.equal(await secrets.getOptional('oauth/mail'), null);
  await assert.rejects(fetch(callback));
});
