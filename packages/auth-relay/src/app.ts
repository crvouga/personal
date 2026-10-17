import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { secureHeaders } from 'hono/secure-headers';
import { loginRoutes, sessionRoutes } from './login';
import { registryRoutes } from './registry';
import { proxyRoutes } from './proxy';
import type { Context, Dependencies } from './types';
import { rateLimit } from './limits';
import { RegistrationError } from './policy';

export function application(deps: Dependencies): Hono<Context> {
  const app = new Hono<Context>();
  app.use('*', bodyLimit({ maxSize: 16384 }));
  app.use('*', rateLimit(deps));
  const headers = secureHeaders({
    referrerPolicy: 'no-referrer',
    contentSecurityPolicy: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'"],
      frameAncestors: ["'none'"],
      formAction: ["'self'"],
    },
  });
  app.use('*', async (c, next) => {
    if (
      c.req.path.startsWith('/realms/') ||
      c.req.path.startsWith('/resources/')
    )
      await next();
    else await headers(c, next);
  });
  app.use('/api/*', async (c, next) => {
    c.header('Cache-Control', 'no-store');
    await next();
  });
  app.get('/health/live', (c) => c.json({ ok: true }));
  app.get('/health/ready', async (c) => {
    await deps.db`SELECT 1 FROM ${deps.db(deps.config.schema)}.bootstrap LIMIT 1`;
    const response = await fetch(
      `${deps.config.upstream}/realms/${deps.config.realm}/.well-known/openid-configuration`,
      { signal: AbortSignal.timeout(3000) }
    );
    const assets = await Bun.file(
      new URL('../dist/app.js', import.meta.url)
    ).exists();
    const ready = response.ok && assets;
    return c.json({ ok: ready }, ready ? 200 : 503);
  });
  app.route('/', loginRoutes(deps));
  app.route('/', sessionRoutes(deps));
  app.route('/', registryRoutes(deps));
  app.route('/', proxyRoutes(deps));
  staticAssets(app, deps.config.developmentIdentity);
  app.onError((error, c) => {
    if (error instanceof RegistrationError)
      return c.json({ error: error.message }, 400);
    console.error(
      'Auth relay request failed',
      c.req.method,
      c.req.path,
      error.name
    );
    return c.json(
      {
        error:
          'Request failed. Check the registration and try a new sign-in; contact an operator if it persists.',
      },
      503
    );
  });
  return app;
}

function staticAssets(app: Hono<Context>, developmentIdentity: boolean): void {
  app.get('/', async (c) => {
    let html = await Bun.file(
      new URL('../ui/index.html', import.meta.url)
    ).text();
    if (developmentIdentity)
      html = html
        .replace(
          'Google sign-in for your projects.',
          'LOCAL DEVELOPMENT — mock identity provider. This is not Google sign-in.'
        )
        .replace('Continue with Google', 'Continue with local test identity')
        .replace(
          'Use the one-time setup credential from Vault.',
          'Local setup credential: local-development-only.'
        );
    return c.html(html);
  });
  app.get(
    '/app.js',
    () =>
      new Response(Bun.file(new URL('../dist/app.js', import.meta.url)), {
        headers: { 'Content-Type': 'text/javascript' },
      })
  );
  app.get(
    '/style.css',
    () =>
      new Response(Bun.file(new URL('../ui/style.css', import.meta.url)), {
        headers: { 'Content-Type': 'text/css' },
      })
  );
}
