import { Manager } from './manager';
import { RegistrationError, type Registration } from './policy';
import type { Dependencies } from './types';

export async function saveRegistration(
  deps: Dependencies,
  record: { id: string; input: Registration; revision: number },
  subject: string
): Promise<void> {
  const { db, config } = deps;
  const { id, input, revision } = record;
  const schema = db(config.schema);
  const manager = new Manager(config);
  // Keep a pending identity if the first provider write has an ambiguous outcome.
  await db`INSERT INTO ${schema}.clients (id, project, environment, instance, desired, expires_at)
      VALUES (${id}, ${input.project}, ${input.environment}, ${input.instance}, ${JSON.stringify(input)}::text::jsonb, ${input.expiresAt}) ON CONFLICT (id) DO NOTHING`;
  await db.begin(async (tx) => {
    const [old] =
      await tx`SELECT * FROM ${schema}.clients WHERE id = ${id} FOR UPDATE`;
    if (old.revision !== revision)
      throw new RegistrationError('Registration changed; reload before saving');
    if (
      old.project !== input.project ||
      old.environment !== input.environment ||
      old.instance !== input.instance
    )
      throw new Error('Client identity is immutable');
    const overlap = [
      ...((old.config?.callbacks ?? []) as string[]),
      ...(new Date(old.overlap_until as string) > new Date()
        ? (old.previous as string[])
        : []),
    ];
    await manager.apply(id, input, overlap);
    // The gateway does not permit a newly added callback until this commit.
    // Remote success followed by a connection loss leaves a safe superset.
    await tx`UPDATE ${schema}.clients SET config = ${JSON.stringify(input)}::text::jsonb, desired = ${JSON.stringify(input)}::text::jsonb, previous = ${JSON.stringify(overlap)}::text::jsonb,
        overlap_until = now() + interval '10 minutes', expires_at = ${input.expiresAt}, revoked = false, remote_clean = false, revision = revision + 1 WHERE id = ${id}`;
    await tx`INSERT INTO ${schema}.audit (subject, action, client_id) VALUES (${subject}, 'save', ${id})`;
  });
}
