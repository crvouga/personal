import { Hono } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { timingSafeEqual } from 'node:crypto';
import * as oidc from 'openid-client';
import { digest, random } from './db';
import type { Context, Dependencies, Session } from './types';

export function cookieName(origin: string): string {
  return origin.startsWith('https:')
    ? '__Host-auth-relay'
    : `auth-relay-local-${new URL(origin).port}`;
}

function transactionCookie(origin: string, state: string): string {
  return `${origin.startsWith('https:') ? '__Host-' : ''}auth-tx-${state}`;
}

export function loginRoutes(deps: Dependencies): Hono<Context> {
  const app = new Hono<Context>();
  const { db, config } = deps;
  const schema = db(config.schema);
  app.get('/auth/login', async (c) => {
    const state = random();
    const verifier = oidc.randomPKCECodeVerifier();
    const binding = random();
    const nonce = random();
    await db`INSERT INTO ${schema}.logins (state, verifier, nonce, binding, expires_at)
      VALUES (${state}, ${verifier}, ${nonce}, ${digest(binding)}, now() + interval '10 minutes')`;
    setCookie(c, transactionCookie(config.origin, state), binding, {
      httpOnly: true,
      secure: config.origin.startsWith('https:'),
      sameSite: 'Lax',
      path: '/',
      maxAge: 600,
    });
    const url = oidc.buildAuthorizationUrl(deps.oidc, {
      redirect_uri: `${config.origin}/auth/callback`,
      scope: 'openid email profile',
      state,
      nonce,
      code_challenge: await oidc.calculatePKCECodeChallenge(verifier),
      code_challenge_method: 'S256',
      kc_idp_hint: 'google',
    });
    return c.redirect(url.href);
  });
  app.get('/auth/callback', async (c) => {
    const state = c.req.query('state') ?? '';
    if (!/^[A-Za-z0-9_-]{43}$/.test(state))
      return c.text('Invalid login state', 400);
    const binding = getCookie(c, transactionCookie(config.origin, state)) ?? '';
    const rows = await db`DELETE FROM ${schema}.logins WHERE state = ${state}
      AND binding = ${digest(binding)} AND expires_at > now() RETURNING verifier, nonce`;
    deleteCookie(c, transactionCookie(config.origin, state), { path: '/' });
    if (!rows[0])
      return c.text(
        'Login expired or browser binding invalid. Start a new sign-in.',
        400
      );
    // Consume before exchange. A one-time code is never retried after a timeout.
    const callback = new URL('/auth/callback', config.origin);
    callback.search = new URL(c.req.url).search;
    const tokens = await oidc.authorizationCodeGrant(deps.oidc, callback, {
      pkceCodeVerifier: rows[0].verifier as string,
      expectedState: state,
      expectedNonce: rows[0].nonce as string,
    });
    const subject = tokens.claims()?.sub;
    if (!subject) return c.text('Identity missing', 401);
    const token = random();
    await db`INSERT INTO ${schema}.sessions (token_hash, subject, csrf, expires_at)
      VALUES (${digest(token)}, ${subject}, ${random()}, now() + interval '8 hours')`;
    setCookie(c, cookieName(config.origin), token, {
      httpOnly: true,
      secure: config.origin.startsWith('https:'),
      sameSite: 'Lax',
      path: '/',
      maxAge: 28800,
    });
    return c.redirect('/');
  });
  return app;
}

export function sessionRoutes(deps: Dependencies): Hono<Context> {
  const app = new Hono<Context>();
  const { db, config } = deps;
  const schema = db(config.schema);
  app.use('/api/*', async (c, next) => {
    const token = digest(getCookie(c, cookieName(config.origin)) ?? '');
    const rows =
      await db`SELECT s.*, EXISTS(SELECT 1 FROM ${schema}.operators o WHERE o.subject = s.subject) AS operator
      FROM ${schema}.sessions s WHERE token_hash = ${token} AND expires_at > now()`;
    if (!rows[0]) return c.json({ error: 'Sign in required' }, 401);
    const session = rows[0] as Session;
    c.set('session', session);
    if (
      c.req.method !== 'GET' &&
      (c.req.header('Origin') !== config.origin ||
        c.req.header('X-CSRF-Token') !== session.csrf)
    ) {
      return c.json({ error: 'Invalid request origin or CSRF token' }, 403);
    }
    await next();
    return;
  });
  app.get('/api/session', async (c) => {
    const operators =
      await db`SELECT count(*)::int AS count FROM ${schema}.operators`;
    return c.json({
      subject: c.get('session').subject,
      csrf: c.get('session').csrf,
      operator: c.get('session').operator,
      setup: operators[0].count === 0,
      issuer: config.issuer,
      environment: config.environment,
    });
  });
  app.post('/api/setup', async (c) => {
    const body = await c.req.json<{ token?: string }>();
    const supplied = Buffer.from(digest(body.token ?? ''));
    if (!timingSafeEqual(supplied, Buffer.from(digest(config.setupToken))))
      return c.json({ error: 'Setup denied' }, 403);
    const claimed = await db.begin(async (tx) => {
      const rows =
        await tx`INSERT INTO ${schema}.bootstrap (id) VALUES (1) ON CONFLICT DO NOTHING RETURNING id`;
      if (!rows.length) return false;
      await tx`INSERT INTO ${schema}.operators (subject) VALUES (${c.get('session').subject})`;
      return true;
    });
    return c.json({ claimed }, claimed ? 200 : 409);
  });
  app.post('/api/logout', async (c) => {
    await db`DELETE FROM ${schema}.sessions WHERE token_hash = ${c.get('session').token_hash}`;
    deleteCookie(c, cookieName(config.origin), { path: '/' });
    return c.json({ ok: true });
  });
  return app;
}
