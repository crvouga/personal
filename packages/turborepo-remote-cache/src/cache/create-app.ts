import { assert } from '@pkgs/assert';
import { Hono } from 'hono';
import {
  createLogger,
  errorDetails,
  logContext,
  observeHttp,
  type Logger,
} from '@pkgs/logger';
import { cors } from 'hono/cors';
import type { ObjectStore } from '@pkgs/object-store/interface';

import { createBearerAuthMiddleware } from './auth';
import { createArtifactsApp } from './artifacts-routes';

export type CacheAppConfig = {
  readonly turboToken: string;
  readonly objectStore: ObjectStore;
  readonly logger?: Logger;
};

export function createCacheApp(config: CacheAppConfig): Hono {
  assert.record(config, 'createCacheApp requires config');
  assert.nonEmptyString(
    config.turboToken,
    'createCacheApp requires turboToken'
  );
  assert.defined(config.objectStore, 'createCacheApp requires objectStore');
  const app = new Hono();
  const log = config.logger ?? createLogger({ name: 'turbo-cache' });
  app.use('*', async (c, next) => {
    c.res = await observeHttp(
      log,
      c.req.raw,
      async () => {
        await next();
        return c.res;
      },
      () => c.req.routePath
    );
  });

  app.use(
    '*',
    cors({
      origin: '*',
      allowMethods: ['GET', 'HEAD', 'PUT', 'POST', 'OPTIONS'],
      allowHeaders: ['Authorization', 'Content-Type', 'x-artifact-tag'],
    })
  );

  app.get('/health', (c) => c.json({ status: 'ok' as const }));

  const artifacts = new Hono();
  artifacts.use('*', createBearerAuthMiddleware(config.turboToken));
  artifacts.route('/', createArtifactsApp(config.objectStore));
  app.route('/', artifacts);

  app.onError((err, c) => {
    log.error('cache_request_failed', {
      route: c.req.routePath,
      error: errorDetails(err),
    });
    return c.json(
      { error: 'Cache request failed', requestId: logContext()['requestId'] },
      500
    );
  });

  assert.defined(app, 'createCacheApp must return app');
  return app;
}
