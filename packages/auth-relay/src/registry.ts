import { Hono } from 'hono';
import { registration } from './policy';
import { saveRegistration } from './registration-store';
import type { Context, Dependencies } from './types';

export function registryRoutes(deps: Dependencies): Hono<Context> {
  const app = new Hono<Context>();
  const { db, config } = deps;
  const schema = db(config.schema);
  app.use('/api/*', async (c, next) => {
    if (!c.get('session').operator)
      return c.json({ error: 'Operator authorization required' }, 403);
    await next();
    return;
  });
  app.get('/api/clients', async (c) =>
    c.json(
      await db`SELECT * FROM ${schema}.clients ORDER BY project, environment, instance`
    )
  );
  app.put('/api/clients/:id', async (c) => {
    const body = await c.req.json<{ revision?: number }>();
    const input = registration(body, config.environment === 'production');
    const id = c.req.param('id');
    if (!/^app-[a-f0-9-]{36}$/.test(id))
      return c.json({ error: 'Invalid client identity' }, 400);
    await saveRegistration(
      deps,
      { id, input, revision: body.revision ?? 0 },
      c.get('session').subject
    );
    return c.json({
      id,
      issuer: config.issuer,
      revision: (body.revision ?? 0) + 1,
    });
  });
  app.delete('/api/clients/:id', async (c) => {
    const id = c.req.param('id');
    await db.begin(async (tx) => {
      await tx`UPDATE ${schema}.clients SET revoked = true, remote_clean = false, revision = revision + 1 WHERE id = ${id}`;
      await tx`INSERT INTO ${schema}.audit (subject, action, client_id) VALUES (${c.get('session').subject}, 'revoke', ${id})`;
    });
    return c.json({ ok: true });
  });
  app.get('/api/operators', async (c) =>
    c.json(await db`SELECT subject FROM ${schema}.operators ORDER BY subject`)
  );
  app.post('/api/operators', async (c) => {
    const body = await c.req.json<{ subject?: string }>();
    if (!body.subject || body.subject.length > 255)
      return c.json({ error: 'Exact relay subject required' }, 400);
    await db`INSERT INTO ${schema}.operators (subject) VALUES (${body.subject}) ON CONFLICT DO NOTHING`;
    return c.json({ ok: true });
  });
  return app;
}
