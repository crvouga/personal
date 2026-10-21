import { expect, spyOn, test } from 'bun:test';
import { Hono } from 'hono';
import { application } from './app';
import { signInError } from './sign-in-error';
import type { Dependencies } from './types';
import { sessionRoutes } from './login';

test('sign-in failures render safe HTML with a fresh sign-in action', async () => {
  const app = new Hono();
  for (const reason of ['expired', 'denied', 'unavailable'] as const)
    app.get(`/${reason}`, (c) => signInError(c, reason));
  for (const [reason, status] of [
    ['expired', 400],
    ['denied', 403],
    ['unavailable', 503],
  ] as const) {
    const response = await app.request(`/${reason}?code=private-code`);
    const html = await response.text();
    expect(response.status).toBe(status);
    expect(response.headers.get('Content-Type')).toContain('text/html');
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(html).toContain('href="/auth/login"');
    expect(html).not.toContain('private-code');
  }
});

test('HTTPS sign-out clears the host-prefixed session cookie with Secure', async () => {
  const db = ((query: string | TemplateStringsArray) => {
    if (typeof query === 'string') return query;
    return Promise.resolve([
      {
        token_hash: 'fixture-hash',
        subject: 'fixture-subject',
        csrf: 'fixture-csrf',
      },
    ]);
  }) as unknown as Dependencies['db'];
  const app = sessionRoutes({
    db,
    config: { schema: 'auth_relay_production', origin: 'https://auth.example' },
  } as Dependencies);
  const response = await app.request('/api/logout', {
    method: 'POST',
    headers: { Origin: 'https://auth.example', 'X-CSRF-Token': 'fixture-csrf' },
  });
  expect(response.status).toBe(200);
  expect(response.headers.get('Set-Cookie')).toContain('__Host-auth-relay=');
  expect(response.headers.get('Set-Cookie')).toContain('Secure');
  expect(response.headers.get('Set-Cookie')).toContain('Max-Age=0');
});

test('a database outage returns a callback page and keeps API failures JSON', async () => {
  const db = ((query: string | TemplateStringsArray) => {
    if (typeof query === 'string') return query;
    throw new Error('database-password-must-stay-private');
  }) as unknown as Dependencies['db'];
  const deps = {
    db,
    config: {
      schema: 'auth_relay_production',
      origin: 'https://auth.example.com',
    },
  } as Dependencies;
  const log = spyOn(console, 'error').mockImplementation(() => {});
  try {
    const app = application(deps);
    const response = await app.request('/auth/callback?code=private-code');
    expect(response.status).toBe(503);
    const html = await response.text();
    expect(html).toContain('Sign-in unavailable');
    expect(html).not.toContain('database-password');
    expect(html).not.toContain('private-code');
    expect(log.mock.calls.flat().join(' ')).not.toContain('private-code');
    const api = await app.request('/api/session');
    expect(api.status).toBe(503);
    expect(api.headers.get('Content-Type')).toContain('application/json');
    expect(await api.text()).not.toContain('registration');
  } finally {
    log.mockRestore();
  }
});
