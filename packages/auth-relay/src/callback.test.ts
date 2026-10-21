import { expect, test } from 'bun:test';
import { generateKeyPairSync, sign } from 'node:crypto';
import { createLogger } from '@pkgs/logger';
import { application } from './app';
import { provider } from './oidc';
import { digest } from './db';
import type { Config } from './config';
import type { Dependencies } from './types';

function fixtureDatabase() {
  const flow = {
    state: '',
    nonce: '',
    verifier: '',
    binding: '',
    consumed: false,
    sessions: 0,
  };
  const db = ((query: string | TemplateStringsArray, ...values: unknown[]) => {
    if (typeof query === 'string') return query;
    const sql = query.join(' ');
    if (sql.startsWith('INSERT INTO') && sql.includes('.logins')) {
      Object.assign(flow, {
        state: values[1],
        verifier: values[2],
        nonce: values[3],
        binding: values[4],
      });
    }
    if (sql.includes('DELETE FROM') && sql.includes('.logins')) {
      const valid = validTransaction(flow, values);
      flow.consumed = true;
      return Promise.resolve(
        valid ? [{ nonce: flow.nonce, verifier: flow.verifier }] : []
      );
    }
    if (sql.includes('INSERT INTO') && sql.includes('.sessions'))
      flow.sessions++;
    return Promise.resolve([{ count: 1 }]);
  }) as unknown as Dependencies['db'];
  return { db, flow };
}

function validTransaction(
  flow: { consumed: boolean; state: string; binding: string },
  values: unknown[]
) {
  return (
    !flow.consumed && values[1] === flow.state && values[2] === flow.binding
  );
}

async function fixture(rejectCode = false) {
  const issuer = 'https://auth.example/realms/projects';
  const { db, flow } = fixtureDatabase();
  const keys = generateKeyPairSync('rsa', { modulusLength: 2048 });
  let exchanges = 0;
  const jwt = () => {
    const encode = (value: unknown) =>
      Buffer.from(JSON.stringify(value)).toString('base64url');
    const now = Math.floor(Date.now() / 1000);
    const input = `${encode({ alg: 'RS256', kid: 'fixture-key' })}.${encode({ iss: issuer, aud: 'console', sub: 'test-subject', nonce: flow.nonce, iat: now, exp: now + 300 })}`;
    return `${input}.${sign('RSA-SHA256', Buffer.from(input), keys.privateKey).toString('base64url')}`;
  };
  const server = Bun.serve({
    port: 0,
    hostname: '127.0.0.1',
    async fetch(request) {
      expect(request.headers.get('x-forwarded-proto')).toBe('https');
      if (request.url.endsWith('/.well-known/openid-configuration'))
        return Response.json({
          issuer,
          authorization_endpoint: `${issuer}/auth`,
          token_endpoint: `${issuer}/token`,
          jwks_uri: `${issuer}/certs`,
          response_types_supported: ['code'],
          subject_types_supported: ['public'],
          id_token_signing_alg_values_supported: ['RS256'],
        });
      if (request.url.endsWith('/certs'))
        return Response.json({
          keys: [
            {
              ...keys.publicKey.export({ format: 'jwk' }),
              kid: 'fixture-key',
              use: 'sig',
              alg: 'RS256',
            },
          ],
        });
      exchanges++;
      const body = new URLSearchParams(await request.text());
      expect(body.get('redirect_uri')).toBe(
        'https://auth.example/auth/callback'
      );
      expect(body.get('code_verifier')).toBe(flow.verifier);
      expect(request.headers.get('traceparent')).toMatch(
        /^00-[a-f0-9]{32}-[a-f0-9]{16}-01$/
      );
      if (rejectCode)
        return Response.json(
          {
            error: 'invalid_grant',
            error_description: 'private-provider-description',
          },
          { status: 400 }
        );
      return Response.json({
        token_type: 'Bearer',
        access_token: 'fixture-access-token',
        id_token: jwt(),
      });
    },
  });
  const config = {
    origin: 'https://auth.example',
    issuer,
    upstream: server.url.origin,
    realm: 'projects',
    schema: 'auth_relay_production',
    environment: 'production',
    consoleId: 'console',
    consoleSecret: 'fixture-secret',
  } as Config;
  const app = application({
    config,
    db,
    oidc: await provider(config),
    log: createLogger({ name: 'callback-test', level: 'silent' }),
  });
  return { app, server, flow, exchanges: () => exchanges };
}

test('production-style HTTPS callback validates a real signed ID token and creates one session', async () => {
  const f = await fixture();
  try {
    const login = await f.app.request('/auth/login');
    const location = new URL(login.headers.get('Location')!);
    expect(location.searchParams.get('nonce')).toBe(f.flow.nonce);
    const cookie = login.headers.get('Set-Cookie')!.split(';')[0]!;
    expect(digest(cookie.split('=')[1]!)).toBe(f.flow.binding);
    const callback = `/auth/callback?state=${f.flow.state}&iss=${encodeURIComponent(location.origin + '/realms/projects')}&code=private-code`;
    const response = await f.app.request(callback, {
      headers: { Cookie: cookie },
    });
    expect(response.status).toBe(302);
    expect(response.headers.get('Set-Cookie')).toContain('__Host-auth-relay=');
    const cleared = response.headers
      .getSetCookie()
      .find((cookie) => cookie.startsWith('__Host-auth-tx-'));
    expect(cleared).toContain('Secure');
    expect(cleared).toContain('Max-Age=0');
    expect(f.flow.sessions).toBe(1);
    expect(
      (await f.app.request(callback, { headers: { Cookie: cookie } })).status
    ).toBe(400);
    expect(f.exchanges()).toBe(1);
  } finally {
    await f.server.stop(true);
  }
});

test('a failed code exchange consumes the transaction once and gives a safe reference page', async () => {
  const f = await fixture(true);
  try {
    const login = await f.app.request('/auth/login');
    const cookie = login.headers.get('Set-Cookie')!.split(';')[0]!;
    const callback = `/auth/callback?state=${f.flow.state}&iss=${encodeURIComponent('https://auth.example/realms/projects')}&code=private-code`;
    const response = await f.app.request(callback, {
      headers: { Cookie: cookie },
    });
    const html = await response.text();
    expect(response.status).toBe(503);
    expect(html).toContain(response.headers.get('X-Request-ID')!);
    expect(html).not.toContain('private-code');
    expect(html).not.toContain('private-provider-description');
    expect(
      (await f.app.request(callback, { headers: { Cookie: cookie } })).status
    ).toBe(400);
    expect(f.flow.sessions).toBe(0);
    expect(f.exchanges()).toBe(1);
  } finally {
    await f.server.stop(true);
  }
});
