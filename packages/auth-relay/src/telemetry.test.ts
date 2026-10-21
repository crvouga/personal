import { expect, spyOn, test } from 'bun:test';
import { createLogger } from '@pkgs/logger';
import { backgroundJob } from './telemetry';
import { maintenance } from './maintenance';
import { readinessRoutes } from './readiness';
import type { Dependencies } from './types';

test('cleanup failures identify the query, SQLSTATE, retry delay and job ID', async () => {
  const db = ((query: string | TemplateStringsArray) => {
    if (typeof query === 'string') return query;
    throw Object.assign(new Error('private-database-detail'), {
      name: 'PostgresError',
      errno: '53300',
    });
  }) as unknown as Dependencies['db'];
  const error = spyOn(console, 'error').mockImplementation(() => {});
  try {
    await backgroundJob(createLogger({ name: 'test' }), () =>
      maintenance({
        db,
        config: { schema: 'auth_relay_production' } as Dependencies['config'],
      })
    );
    const event = JSON.parse(String(error.mock.calls[0]?.[0]));
    expect(event.jobId).toMatch(/^[0-9a-f-]{36}$/);
    expect(event.retryInMs).toBe(60000);
    expect(event.error.operation).toBe('cleanup.logins');
    expect(event.error.cause.reason).toBe('database_connection_exhausted');
    expect(JSON.stringify(event)).not.toContain('private-database-detail');
  } finally {
    error.mockRestore();
  }
});

test('readiness distinguishes a database failure from healthy identity discovery and assets', async () => {
  const upstream = Bun.serve({
    port: 0,
    hostname: '127.0.0.1',
    fetch(request) {
      expect(request.headers.get('x-forwarded-proto')).toBe('https');
      return Response.json({ issuer: 'https://auth.example/realms/projects' });
    },
  });
  const db = ((query: string | TemplateStringsArray) => {
    if (typeof query === 'string') return query;
    return Promise.reject(
      Object.assign(new Error('private-db-password'), { errno: '42501' })
    );
  }) as unknown as Dependencies['db'];
  try {
    const app = readinessRoutes({
      db,
      config: {
        schema: 'auth_relay_production',
        origin: 'https://auth.example',
        upstream: upstream.url.origin,
        realm: 'projects',
        issuer: 'https://auth.example/realms/projects',
      } as Dependencies['config'],
    });
    const response = await app.request('/health/ready');
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      ok: false,
      checks: { database: false, identity: true, assets: true },
    });
  } finally {
    await upstream.stop(true);
  }
});
