import type { MiddlewareHandler } from 'hono';
import type { AgentContext } from './agent-api';
import type { Dependencies } from './types';
import { digest } from './db';
import type { SQL } from 'bun';
import type { Config } from './config';
import type { AgentGrant } from './agent-policy';
import { RegistrationError } from './policy';

export interface AgentIdentity {
  id: string;
  tokenHash: string;
  grant: AgentGrant;
}

export async function lockAgent(
  db: SQL,
  config: Config,
  agent: AgentIdentity
): Promise<AgentGrant> {
  const schema = db(config.schema);
  // Hold through provider update + commit. Revocation/rotation cannot race a write.
  const [row] = await db`SELECT config FROM ${schema}.agent_grants
    WHERE id = ${agent.id} AND token_hash = ${agent.tokenHash}
    AND NOT revoked AND expires_at > now() FOR SHARE`;
  if (!row)
    throw new RegistrationError('Agent grant expired, rotated or revoked');
  return row.config as AgentGrant;
}

export function authenticateAgent({
  db,
  config,
}: Dependencies): MiddlewareHandler<AgentContext> {
  return async (c, next) => {
    c.header('Cache-Control', 'no-store');
    if (c.req.header('Origin') || c.req.header('Cookie'))
      return c.json(
        {
          error:
            'Use a server-side bearer credential without browser cookies or Origin',
        },
        403
      );
    const match = /^Bearer ([A-Za-z0-9_-]{43,256})$/.exec(
      c.req.header('Authorization') ?? ''
    );
    if (!match)
      return c.json({ error: 'Agent bearer credential required' }, 401, {
        'WWW-Authenticate': 'Bearer',
      });
    const tokenHash = digest(match[1]!);
    const schema = db(config.schema);
    const [row] = await db`SELECT id, config FROM ${schema}.agent_grants
      WHERE token_hash = ${tokenHash} AND NOT revoked AND expires_at > now()`;
    if (!row)
      return c.json(
        { error: 'Agent credential invalid, expired or revoked' },
        401,
        { 'WWW-Authenticate': 'Bearer' }
      );
    c.set('agent', {
      id: row.id as string,
      tokenHash,
      grant: row.config as AgentGrant,
    });
    await next();
    return;
  };
}
