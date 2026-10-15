import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { Hono } from 'hono';

import { FleetAdminAuth, TOKEN_ACTOR } from '../../src/auth/admin-auth';
import { SESSION_SECONDS } from '../../src/auth/session';
import { ADMIN_TOKEN, Clock, SESSION_SECRET, silent } from '../support/api';
import { recordingLogger, startFakeVault } from '../support/fake-vault';

const vault = startFakeVault();
afterAll(() => vault.stop());

const clock = new Clock();
const auth = new FleetAdminAuth({
  env: {
    adminToken: ADMIN_TOKEN,
    sessionSecret: SESSION_SECRET,
    vaultAddr: vault.url,
  },
  now: clock.now,
  fetch,
  log: silent,
  vaultTimeoutMs: 500,
});

/** A route that reports what the auth object decided about the request. */
const probe = new Hono();
probe.all('/probe', async (c) =>
  c.json({ actor: await auth.actor(c), sameOrigin: auth.sameOrigin(c) })
);

async function ask(
  headers: Record<string, string>,
  host = 'fleet.example.test'
): Promise<{ actor: string | null; sameOrigin: boolean }> {
  const res = await probe.request(`http://${host}/probe`, {
    method: 'POST',
    headers,
  });
  return res.json();
}

const cookieOf = (setCookie: string): string => setCookie.split(';')[0] ?? '';

beforeEach(() => {
  clock.set(new Date('2026-10-14T12:00:00.000Z'));
  vault.calls.length = 0;
  vault.mode = 'normal';
});

describe('actor: bearer token', () => {
  test('the admin token identifies the token actor', async () => {
    expect((await ask({ Authorization: `Bearer ${ADMIN_TOKEN}` })).actor).toBe(
      TOKEN_ACTOR
    );
  });

  test('anything else does not', async () => {
    const wrong = [
      `Bearer ${ADMIN_TOKEN}x`,
      `Bearer ${ADMIN_TOKEN.slice(1)}`,
      'Bearer ',
      'Bearer',
      `Basic ${ADMIN_TOKEN}`,
      ADMIN_TOKEN,
      'Bearer wrong',
    ];
    for (const Authorization of wrong)
      expect((await ask({ Authorization })).actor).toBeNull();
    expect((await ask({})).actor).toBeNull();
  });

  test('a node credential is not an admin credential', async () => {
    const nodeToken = `${'a'.repeat(64)}.${'b'.repeat(64)}`;
    expect(
      (await ask({ Authorization: `Bearer ${nodeToken}` })).actor
    ).toBeNull();
  });
});

describe('login and the session cookie', () => {
  test('a Vault admin gets a cookie that identifies them', async () => {
    const result = await auth.login('chris', 'correct horse');
    expect(result?.actor).toBe('chris');
    expect(result?.cookie).toContain('HttpOnly');
    expect(result?.cookie).toContain('Secure');
    expect(result?.cookie).toContain('SameSite=Lax');
    expect((await ask({ Cookie: cookieOf(result?.cookie ?? '') })).actor).toBe(
      'chris'
    );
  });

  test('refused logins return null and issue nothing', async () => {
    expect(await auth.login('chris', 'wrong')).toBeNull();
    expect(await auth.login('ops.bob', 'bob-password')).toBeNull();
    expect(await auth.login('../x', 'p')).toBeNull();
    vault.mode = 'error';
    expect(await auth.login('chris', 'correct horse')).toBeNull();
  });

  test('the session lasts twelve hours to the second', async () => {
    const result = await auth.login('chris', 'correct horse');
    const cookie = cookieOf(result?.cookie ?? '');
    clock.advance(SESSION_SECONDS - 1);
    expect((await ask({ Cookie: cookie })).actor).toBe('chris');
    clock.advance(1);
    expect((await ask({ Cookie: cookie })).actor).toBeNull();
  });

  test('a tampered cookie is refused', async () => {
    const result = await auth.login('chris', 'correct horse');
    const cookie = cookieOf(result?.cookie ?? '');
    const [name = '', value = ''] = cookie.split('=');
    const [encoded = '', expiry = '', signature = ''] = value.split('.');
    const forgeries = [
      `${name}=${Buffer.from('root').toString('base64url')}.${expiry}.${signature}`,
      `${name}=${encoded}.${Number(expiry) + 3600}.${signature}`,
      `${name}=${encoded}.${expiry}.${signature.replace(/.$/, 'f')}`,
      `${name}=garbage`,
      `${name}=`,
    ].filter((forged) => forged !== cookie);
    for (const Cookie of forgeries)
      expect((await ask({ Cookie })).actor).toBeNull();
  });

  test('a cookie signed with another secret is refused', async () => {
    const other = new FleetAdminAuth({
      env: {
        adminToken: ADMIN_TOKEN,
        sessionSecret: `${SESSION_SECRET}-other`,
        vaultAddr: vault.url,
      },
      now: clock.now,
      fetch,
      log: silent,
    });
    const result = await other.login('chris', 'correct horse');
    expect(
      (await ask({ Cookie: cookieOf(result?.cookie ?? '') })).actor
    ).toBeNull();
  });

  test('the cookie is read among other cookies', async () => {
    const result = await auth.login('chris', 'correct horse');
    const Cookie = `theme=dark; ${cookieOf(result?.cookie ?? '')}; other=1`;
    expect((await ask({ Cookie })).actor).toBe('chris');
  });

  test('logout gives a cookie that clears the session', () => {
    expect(auth.logoutCookie()).toContain('Max-Age=0');
    expect(auth.logoutCookie()).toContain('fleet_session=;');
  });

  test('login is off when there is no Vault address', async () => {
    const off = new FleetAdminAuth({
      env: {
        adminToken: ADMIN_TOKEN,
        sessionSecret: SESSION_SECRET,
        vaultAddr: null,
      },
      now: clock.now,
      fetch,
      log: recordingLogger(),
    });
    expect(await off.login('chris', 'correct horse')).toBeNull();
  });
});

describe('sameOrigin (CSRF)', () => {
  test('an Origin that names this host passes', async () => {
    expect(
      (await ask({ Origin: 'https://fleet.example.test' })).sameOrigin
    ).toBe(true);
  });

  test('another site, subdomain, parent, port or scheme-less value does not', async () => {
    for (const Origin of [
      'https://evil.example',
      'https://fleet.example.test.evil.example',
      'https://evil.fleet.example.test',
      'https://example.test',
      'https://fleet.example.test:8443',
      'fleet.example.test',
      'null',
      '',
    ]) {
      expect((await ask({ Origin })).sameOrigin).toBe(false);
    }
  });

  test('without Origin, a Referer from this host passes and another does not', async () => {
    expect(
      (await ask({ Referer: 'https://fleet.example.test/settings' })).sameOrigin
    ).toBe(true);
    expect(
      (await ask({ Referer: 'https://evil.example/fleet.example.test' }))
        .sameOrigin
    ).toBe(false);
  });

  test('with neither header the request is refused', async () => {
    expect((await ask({})).sameOrigin).toBe(false);
  });

  test('a present Origin decides, even if the Referer would pass', async () => {
    const reply = await ask({
      Origin: 'https://evil.example',
      Referer: 'https://fleet.example.test/',
    });
    expect(reply.sameOrigin).toBe(false);
  });

  test('behind a proxy, the forwarded host counts', async () => {
    const reply = await ask({
      Origin: 'https://fleet.chrisvouga.dev',
      'X-Forwarded-Host': 'fleet.chrisvouga.dev',
    });
    expect(reply.sameOrigin).toBe(true);
  });

  test('a forged Host header cannot make a foreign origin pass', async () => {
    const res = await probe.request('http://fleet.example.test/probe', {
      method: 'POST',
      headers: { Origin: 'https://evil.example', Host: 'fleet.example.test' },
    });
    expect((await res.json()).sameOrigin).toBe(false);
  });
});
