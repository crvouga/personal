import { Hono } from 'hono';
import { errorDetails } from '@pkgs/logger';
import { forwardedHeaders } from './oidc';
import { step } from './telemetry';
import type { Context, Dependencies } from './types';

export function readinessRoutes(
  deps: Pick<Dependencies, 'db' | 'config' | 'log'>,
  assetsAvailable = async () =>
    (
      await Promise.all(
        ['app.js', 'app.css', 'theme-init.js'].map((file) =>
          Bun.file(new URL(`../dist/${file}`, import.meta.url)).exists()
        )
      )
    ).every(Boolean)
): Hono<Context> {
  const app = new Hono<Context>();
  app.get('/health/live', (c) => c.json({ ok: true }));
  app.get('/health/ready', async (c) => {
    const checks: Record<string, boolean> = {};
    const check = async (name: string, work: () => PromiseLike<unknown>) => {
      try {
        await step(`readiness.${name}`, work);
        checks[name] = true;
      } catch (error) {
        checks[name] = false;
        deps.log?.error('readiness_failed', {
          component: name,
          error: errorDetails(error),
        });
      }
    };
    await check(
      'database',
      () =>
        deps.db`SELECT c.agent_id, g.token_hash FROM ${deps.db(deps.config.schema)}.bootstrap b
          LEFT JOIN ${deps.db(deps.config.schema)}.clients c ON false
          LEFT JOIN ${deps.db(deps.config.schema)}.agent_grants g ON g.id = c.agent_id LIMIT 0`
    );
    await check('identity', async () => {
      const response = await fetch(
        `${deps.config.upstream}/realms/${deps.config.realm}/.well-known/openid-configuration`,
        {
          headers: forwardedHeaders(deps.config.origin, undefined),
          signal: AbortSignal.timeout(3000),
        }
      );
      if (!response.ok)
        throw Object.assign(new Error('Discovery unavailable'), {
          status: response.status,
        });
      const doc = (await response.json()) as { issuer?: string };
      if (doc.issuer !== deps.config.issuer)
        throw Object.assign(new Error('Discovery issuer mismatch'), {
          code: 'AUTH_DISCOVERY_ISSUER_MISMATCH',
        });
    });
    await check('assets', async () => {
      if (!(await assetsAvailable()))
        throw Object.assign(new Error('UI bundle missing'), {
          code: 'AUTH_UI_ASSETS_MISSING',
        });
    });
    const ready = Object.values(checks).every(Boolean);
    c.header('Cache-Control', 'no-store');
    return c.json(
      { ok: ready, checks, requestId: c.get('requestId') },
      ready ? 200 : 503
    );
  });
  return app;
}
