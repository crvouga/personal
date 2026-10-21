import type { Dependencies } from './types';
import { Manager } from './manager';
import type { Registration } from './policy';
import { step } from './telemetry';

export async function maintenance({
  db,
  config,
}: Pick<Dependencies, 'db' | 'config'>): Promise<void> {
  const schema = db(config.schema);
  await step(
    'cleanup.logins',
    () => db`DELETE FROM ${schema}.logins WHERE expires_at < now()`
  );
  await step(
    'cleanup.sessions',
    () => db`DELETE FROM ${schema}.sessions WHERE expires_at < now()`
  );
  await step(
    'cleanup.limits',
    () =>
      db`DELETE FROM ${schema}.limits WHERE "window" < ${Math.floor(Date.now() / 60000) - 5}`
  );
  // Multiple replicas safely share this work. Expiry/revocation is enforced by
  // the gateway immediately even if the private provider is unavailable.
  await step('cleanup.clients', () =>
    db.begin(async (tx) => {
      const rows = await tx`SELECT * FROM ${schema}.clients WHERE
      ((NOT remote_clean AND (revoked OR expires_at < now())) OR overlap_until < now()) FOR UPDATE SKIP LOCKED LIMIT 10`;
      const manager = new Manager(config);
      for (const row of rows) {
        const expired =
          row.revoked || new Date(row.expires_at as string) < new Date();
        await manager.apply(
          row.id as string,
          expired ? null : (row.config as Registration),
          []
        );
        await tx`UPDATE ${schema}.clients SET previous = '[]'::jsonb, overlap_until = NULL,
        remote_clean = ${!!expired} WHERE id = ${row.id}`;
      }
    })
  );
}
