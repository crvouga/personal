import { expect, test } from 'bun:test';
import { proxyRoutes } from './proxy';
import type { Dependencies } from './types';

function fixture() {
  const requests: { url: string; headers: Headers; body: string }[] = [];
  const server = Bun.serve({
    port: 0,
    hostname: '127.0.0.1',
    async fetch(request) {
      requests.push({
        url: request.url,
        headers: new Headers(request.headers),
        body: await request.text(),
      });
      return new Response('upstream');
    },
  });
  const db = ((query: string | TemplateStringsArray, ...values: unknown[]) => {
    if (typeof query === 'string') return query;
    return Promise.resolve(
      values[1] === 'application'
        ? [{ config: { callbacks: ['https://app.example/callback'] } }]
        : []
    );
  }) as unknown as Dependencies['db'];
  const config = {
    origin: 'https://auth.example',
    upstream: server.url.origin,
    realm: 'projects',
    schema: 'auth_relay_production',
    consoleId: 'console',
  } as Dependencies['config'];
  return { app: proxyRoutes({ db, config } as Dependencies), server, requests };
}

const authorization = '/realms/projects/protocol/openid-connect/auth';
const params = {
  client_id: 'application',
  redirect_uri: 'https://app.example/callback',
  response_type: 'code',
  scope: 'openid email profile',
  state: 'browser-state',
  nonce: 'browser-nonce',
  code_challenge: 'a'.repeat(43),
  code_challenge_method: 'S256',
};

test('console and application authorizations require Google despite SSO cookies or caller hints', async () => {
  const f = fixture();
  try {
    for (const client_id of ['console', 'application']) {
      for (const prompt of [undefined, 'none', 'select_account', 'consent']) {
        const query = new URLSearchParams({ ...params, client_id });
        if (prompt) query.set('prompt', prompt);
        if (prompt === 'consent') query.append('prompt', 'none');
        query.set('kc_idp_hint', 'another-provider');
        query.set('login_hint', 'previous@example.test');
        query.set('id_token_hint', 'previous-token');
        const response = await f.app.request(`${authorization}?${query}`, {
          headers: { Cookie: 'KEYCLOAK_IDENTITY=existing-broker-session' },
        });
        expect(response.status).toBe(200);
        const request = f.requests.at(-1)!;
        const forwarded = new URL(request.url).searchParams;
        expect(forwarded.getAll('prompt')).toEqual(['login']);
        expect(forwarded.getAll('kc_idp_hint')).toEqual(['google']);
        expect(forwarded.has('login_hint')).toBe(false);
        expect(forwarded.has('id_token_hint')).toBe(false);
        for (const [key, value] of Object.entries({ ...params, client_id }))
          expect(forwarded.get(key)).toBe(value);
        expect(request.headers.get('Cookie')).toContain('KEYCLOAK_IDENTITY=');
      }
    }
  } finally {
    await f.server.stop(true);
  }
});

test('forcing account selection preserves callback policy and token requests', async () => {
  const f = fixture();
  try {
    const query = new URLSearchParams({
      ...params,
      redirect_uri: 'https://unregistered.example/callback',
    });
    expect((await f.app.request(`${authorization}?${query}`)).status).toBe(400);
    expect(f.requests).toHaveLength(0);
    const body = new URLSearchParams({ ...params, code: 'one-time-code' });
    const response = await f.app.request(
      '/realms/projects/protocol/openid-connect/token',
      { method: 'POST', body }
    );
    expect(response.status).toBe(200);
    const request = f.requests[0]!;
    expect(new URL(request.url).search).toBe('');
    expect(request.body).toBe(body.toString());
  } finally {
    await f.server.stop(true);
  }
});
