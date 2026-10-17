import { SQL } from 'bun';
import { command } from './process';

export function assertCluster(expected: string, actual: string): void {
  if (!/^\d+$/.test(expected) || expected !== actual)
    throw new Error(
      'The local database port does not reach this instance’s PostgreSQL cluster. Stop the conflicting listener and retry; no schema changes were applied.'
    );
}

/** A read-only identity check before OpenTofu can write through a host forwarder. */
export async function verifyDatabase(
  compose: string[],
  env: NodeJS.ProcessEnv
): Promise<void> {
  const expected = await command(
    [
      ...compose,
      'exec',
      '-T',
      'db',
      'psql',
      '-U',
      'development',
      '-d',
      'auth_relay_development',
      '-Atc',
      'SELECT system_identifier FROM pg_control_system()',
    ],
    env,
    true,
    { timeoutMs: 15000 }
  );
  const sql = new SQL({
    url: `postgres://development:development-only@127.0.0.1:${env['AUTH_LOCAL_DATABASE_PORT']}/auth_relay_development?sslmode=disable`,
    max: 1,
    connectionTimeout: 5,
  });
  const query = sql`SELECT system_identifier::text AS identity FROM pg_control_system()`;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      void query.cancel();
      reject(
        new Error(
          'Local database identity verification timed out; no schema changes were applied'
        )
      );
    }, 5000);
  });
  try {
    const rows = await Promise.race([query, deadline]);
    assertCluster(expected.trim(), rows[0]?.identity);
  } finally {
    clearTimeout(timer);
    await sql.close({ timeout: 0 });
  }
}
