import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { NONCE, secureHeaders } from 'hono/secure-headers';
import { loginRoutes, sessionRoutes } from './login';
import { registryRoutes } from './registry';
import { proxyRoutes } from './proxy';
import type { Context, Dependencies } from './types';
import { rateLimit } from './limits';
import { RegistrationError } from './policy';
import { signInError } from './sign-in-error';
import {
  errorDetails,
  logContext,
  observeHttp,
  withLogContext,
} from '@pkgs/logger';
import { relayLogger } from './telemetry';
import { readinessRoutes } from './readiness';
import { staticAssets } from './static-assets';
import { agentRoutes } from './agent-api';
import { agentGrantRoutes } from './agent-grants';

export function application(deps: Dependencies): Hono<Context> {
  const app = new Hono<Context>();
  const log = deps.log ?? relayLogger(deps.config);
  app.use('*', async (c, next) => {
    const response = await observeHttp(
      log,
      c.req.raw,
      async () => {
        c.set('requestId', String(logContext()['requestId']));
        return withLogContext({ route: c.req.routePath }, async () => {
          await next();
          return c.res;
        });
      },
      () => c.req.routePath
    );
    c.res = response;
  });
  app.use('*', bodyLimit({ maxSize: 16384 }));
  app.use('*', rateLimit(deps));
  const headers = consoleHeaders();
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
  app.route('/', readinessRoutes({ ...deps, log }));
  app.route('/', loginRoutes(deps));
  app.route('/', sessionRoutes(deps));
  app.route('/', registryRoutes(deps));
  app.route('/', agentGrantRoutes(deps));
  app.route('/', agentRoutes(deps));
  app.route('/', proxyRoutes(deps));
  staticAssets(app, deps.config.developmentIdentity);
  app.onError((error, c) => {
    if (error instanceof RegistrationError)
      return c.json({ error: error.message }, 400);
    log.error('request_failed', {
      route: c.req.routePath,
      error: errorDetails(error),
    });
    if (c.req.path.startsWith('/auth/')) return signInError(c, 'unavailable');
    return c.json(
      {
        requestId: c.get('requestId'),
        error:
          'Authentication relay unavailable. Try again shortly; contact an operator if it persists.',
      },
      503
    );
  });
  return app;
}

export function consoleHeaders() {
  return secureHeaders({
    referrerPolicy: 'no-referrer',
    contentSecurityPolicy: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", NONCE],
      styleSrcAttr: ["'unsafe-inline'"],
      frameAncestors: ["'none'"],
      formAction: ["'self'"],
    },
  });
}
