import { Hono } from 'hono';
import { agentGrant } from './agent-policy';
import { RegistrationError } from './policy';
import type { Context, Dependencies } from './types';

export function agentGrantRoutes({ db, config }: Dependencies): Hono<Context> {
  const app = new Hono<Context>();
  const schema = db(config.schema);
  // Mounted after registryRoutes' operator middleware and session/CSRF checks.
  app.get('/api/agent-grants', async (c) =>
    c.json(
      await db`SELECT id, config, revision, revoked FROM ${schema}.agent_grants ORDER BY id`
    )
  );
  app.put('/api/agent-grants/:id', async (c) => {
    const id = c.req.param('id');
    if (!/^grant-[a-f0-9-]{36}$/.test(id))
      throw new RegistrationError('Invalid grant identity');
    const body = await c.req.json<{ revision?: number }>();
    const input = agentGrant(body, config.environment === 'production');
    const revision = body.revision ?? 0;
    if (!Number.isSafeInteger(revision) || revision < 0)
      throw new RegistrationError('Invalid revision');
    await db.begin(async (tx) => {
      await tx`INSERT INTO ${schema}.agent_grants (id, token_hash, config, expires_at)
        VALUES (${id}, ${input.tokenHash}, ${JSON.stringify(input)}::text::jsonb, ${input.expiresAt}) ON CONFLICT (id) DO NOTHING`;
      const [old] =
        await tx`SELECT * FROM ${schema}.agent_grants WHERE id = ${id} FOR UPDATE`;
      if (old.revision !== revision || old.config.project !== input.project)
        throw new RegistrationError(
          'Grant changed or project differs; reload before saving'
        );
      await tx`UPDATE ${schema}.agent_grants SET token_hash = ${input.tokenHash}, config = ${JSON.stringify(input)}::text::jsonb,
        expires_at = ${input.expiresAt}, revoked = false, revision = revision + 1 WHERE id = ${id}`;
      await tx`INSERT INTO ${schema}.audit (subject, action, client_id) VALUES (${c.get('session').subject}, 'grant.save', ${id})`;
    });
    return c.json({ id, revision: revision + 1 });
  });
  app.delete('/api/agent-grants/:id', async (c) => {
    await db.begin(async (tx) => {
      const id = c.req.param('id');
      await tx`UPDATE ${schema}.agent_grants SET revoked = true, revision = revision + 1 WHERE id = ${id}`;
      await tx`INSERT INTO ${schema}.audit (subject, action, client_id) VALUES (${c.get('session').subject}, 'grant.revoke', ${id})`;
    });
    return c.json({ ok: true });
  });
  return app;
}
