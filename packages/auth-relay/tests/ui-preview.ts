// Explicit loopback-only UI fixture. No database, provider, secrets, or live data.
// Build first, then run: bun tests/ui-preview.ts
import { Hono } from 'hono';
import { consoleHeaders } from '../src/app';
import { staticAssets } from '../src/static-assets';
import type { Context } from '../src/types';
import type { Client, Registration, Session } from '../ui/model';
import { registration } from '../src/policy';

const app = new Hono<Context>();
const session: Session = {
  csrf: 'ui-fixture-csrf',
  subject: 'local-ui-operator',
  operator: true,
  setup: false,
  issuer: 'http://localhost:18091/realms/ui-fixture',
  environment: 'nonproduction',
};
let scenario = 'operator';
let failWrite = false;
let failList = false;
const operators = [{ subject: session.subject }];
const clients: Client[] = [
  'Portfolio',
  'Fleet dashboard',
  'Preview environment',
].map((name, index) => {
  const config: Registration = {
    name,
    project: ['portfolio', 'fleet', 'web'][index]!,
    instance: 'primary',
    environment: 'localhost',
    callbacks: [`http://localhost:${5173 + index}/callback`],
    expiresAt: new Date(Date.now() + 86400_000).toISOString(),
  };
  return {
    id: `app-${crypto.randomUUID()}`,
    revision: 1,
    config,
    desired: config,
    revoked: index === 2,
    expires_at: index === 1 ? '2020-01-01T00:00:00Z' : config.expiresAt,
  };
});
app.use('*', consoleHeaders());
app.post('/__test/state', async (c) => {
  const body = await c.req.json();
  scenario = body.scenario ?? scenario;
  failWrite = body.failWrite ?? false;
  failList = body.failList ?? false;
  return c.json({ ok: true });
});
app.get('/api/session', (c) => {
  if (scenario === 'anonymous')
    return c.json({ error: 'Sign in required' }, 401);
  if (scenario === 'unavailable') return c.json({ error: 'Unavailable' }, 503);
  return c.json({
    ...session,
    operator: scenario === 'operator',
    setup: scenario === 'setup',
  });
});
app.get('/api/clients', (c) =>
  failList
    ? c.json({ error: 'Fixture list unavailable' }, 503)
    : c.json(clients)
);
app.get('/api/operators', (c) => c.json(operators));
app.post('/api/operators', async (c) => {
  operators.push(await c.req.json());
  return c.json({ ok: true });
});
app.post('/api/setup', async (c) => {
  if ((await c.req.json()).token !== 'local-development-only')
    return c.json({ error: 'Setup denied' }, 403);
  scenario = 'operator';
  return c.json({ claimed: true });
});
app.post('/api/logout', (c) => {
  scenario = 'anonymous';
  return c.json({ ok: true });
});
app.put('/api/clients/:id', async (c) => {
  if (failWrite)
    return c.json({ error: 'Registration changed; reload before saving' }, 400);
  const body = await c.req.json();
  try {
    const config = registration(body, false);
    let client = clients.find((item) => item.id === c.req.param('id'));
    if (client && client.revision !== body.revision)
      return c.json(
        { error: 'Registration changed; reload before saving' },
        400
      );
    if (!client) {
      client = {
        id: c.req.param('id'),
        revision: 0,
        config,
        desired: config,
        revoked: false,
        expires_at: config.expiresAt,
      };
      clients.push(client);
    }
    Object.assign(client, {
      config,
      desired: config,
      expires_at: config.expiresAt,
      revoked: false,
      revision: client.revision + 1,
    });
    return c.json({ id: client.id, revision: client.revision });
  } catch (error) {
    return c.json(
      {
        error: error instanceof Error ? error.message : 'Invalid registration',
      },
      400
    );
  }
});
app.delete('/api/clients/:id', (c) => {
  const client = clients.find((item) => item.id === c.req.param('id'));
  if (client) {
    client.revoked = true;
    client.revision += 1;
  }
  return c.json({ ok: true });
});
staticAssets(app, true);
const server = Bun.serve({
  hostname: '127.0.0.1',
  port: 18091,
  fetch: app.fetch,
});
console.warn(`UI fixture only: ${server.url}`);
