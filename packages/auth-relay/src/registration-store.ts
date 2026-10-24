import { Manager } from './manager';
import { RegistrationError, type Registration } from './policy';
import type { Dependencies } from './types';
import { lockAgent, type AgentIdentity } from './agent-auth';
import { authorizeRegistration } from './agent-policy';

export async function saveRegistration(
  deps: Dependencies,
  record: { id: string; input: Registration; revision: number },
  subject: string,
  agent?: AgentIdentity
): Promise<void> {
  const { db, config } = deps;
  const { id, input, revision } = record;
  const schema = db(config.schema);
  const manager = new Manager(config);
  // Keep a pending identity if the first provider write has an ambiguous outcome.
  await reserveRegistration(deps, record, agent);
  await db.begin(async (tx) => {
    if (agent) authorizeRegistration(await lockAgent(tx, config, agent), input);
    const [old] =
      await tx`SELECT * FROM ${schema}.clients WHERE id = ${id} FOR UPDATE`;
    if (!old)
      throw new RegistrationError(
        'Project/environment/instance already registered; an operator must resolve ownership'
      );
    if (agent && old.agent_id !== agent.id)
      throw new RegistrationError('Client is not owned by this agent grant');
    if (old.revision !== revision)
      throw new RegistrationError('Registration changed; reload before saving');
    if (
      old.project !== input.project ||
      old.environment !== input.environment ||
      old.instance !== input.instance
    )
      throw new RegistrationError('Client identity is immutable');
    const overlap = previousCallbacks(old);
    await manager.apply(id, input, overlap);
    // The gateway does not permit a newly added callback until this commit.
    // Remote success followed by a connection loss leaves a safe superset.
    await tx`UPDATE ${schema}.clients SET config = ${JSON.stringify(input)}::text::jsonb, desired = ${JSON.stringify(input)}::text::jsonb, previous = ${JSON.stringify(overlap)}::text::jsonb,
        overlap_until = now() + interval '10 minutes', expires_at = ${input.expiresAt}, revoked = false, remote_clean = false, revision = revision + 1 WHERE id = ${id}`;
    await tx`INSERT INTO ${schema}.audit (subject, action, client_id) VALUES (${subject}, 'save', ${id})`;
  });
}

async function reserveRegistration(
  { db, config }: Dependencies,
  { id, input }: { id: string; input: Registration },
  agent?: AgentIdentity
): Promise<void> {
  await db.begin(async (tx) => {
    if (agent) authorizeRegistration(await lockAgent(tx, config, agent), input);
    const schema = tx(config.schema);
    await tx`INSERT INTO ${schema}.clients (id, project, environment, instance, desired, expires_at, agent_id)
      VALUES (${id}, ${input.project}, ${input.environment}, ${input.instance}, ${JSON.stringify(input)}::text::jsonb, ${input.expiresAt}, ${agent?.id ?? null}) ON CONFLICT DO NOTHING`;
  });
}

function previousCallbacks(old: {
  config?: Registration;
  overlap_until: string;
  previous: string[];
}): string[] {
  return [
    ...(old.config?.callbacks ?? []),
    ...(new Date(old.overlap_until) > new Date() ? old.previous : []),
  ];
}
