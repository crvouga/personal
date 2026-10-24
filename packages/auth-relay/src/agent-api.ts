import { Hono } from 'hono';
import { authorizeRegistration, clientId } from './agent-policy';
import { authenticateAgent, lockAgent, type AgentIdentity } from './agent-auth';
import { RegistrationError, registration } from './policy';
import { saveRegistration } from './registration-store';
import type { Dependencies } from './types';

export type AgentContext = { Variables: { agent: AgentIdentity } };

export function agentRoutes(deps: Dependencies): Hono<AgentContext> {
  const app = new Hono<AgentContext>();
  const { db, config } = deps;
  const schema = db(config.schema);
  app.use('/agent/v1/*', authenticateAgent(deps));
  app.get('/agent/v1/clients', async (c) => {
    const agent = c.get('agent');
    const clients =
      await db`SELECT id, config, desired, revision, revoked FROM ${schema}.clients
      WHERE agent_id = ${agent.id} ORDER BY environment, instance`;
    return c.json({ issuer: config.issuer, grant: agent.grant, clients });
  });
  app.put('/agent/v1/clients/:id', async (c) => {
    const id = c.req.param('id');
    if (!clientId(id)) throw new RegistrationError('Invalid client identity');
    const body = await c.req.json<{ revision?: number }>();
    const input = registration(body, config.environment === 'production');
    const revision = body.revision ?? 0;
    if (!Number.isSafeInteger(revision) || revision < 0)
      throw new RegistrationError('Invalid revision');
    const agent = c.get('agent');
    authorizeRegistration(agent.grant, input);
    await saveRegistration(
      deps,
      { id, input, revision },
      `agent:${agent.id}`,
      agent
    );
    return c.json({
      id,
      issuer: config.issuer,
      revision: revision + 1,
      settings: {
        OIDC_ISSUER: config.issuer,
        OIDC_CLIENT_ID: id,
        OIDC_REDIRECT_URI: input.callbacks[0],
        OIDC_SCOPES: 'openid email profile',
      },
    });
  });
  app.delete('/agent/v1/clients/:id', async (c) => {
    const agent = c.get('agent');
    await db.begin(async (tx) => {
      await lockAgent(tx, config, agent);
      const rows =
        await tx`UPDATE ${schema}.clients SET revoked = true, remote_clean = false, revision = revision + 1
        WHERE id = ${c.req.param('id')} AND agent_id = ${agent.id} RETURNING id`;
      if (!rows.length)
        throw new RegistrationError('Client is not owned by this agent grant');
      await tx`INSERT INTO ${schema}.audit (subject, action, client_id)
        VALUES (${`agent:${agent.id}`}, 'revoke', ${c.req.param('id')})`;
    });
    return c.json({ ok: true });
  });
  return app;
}
