import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import pg from 'pg';

const database = () => resolve(process.env.DATA_DIR || '/tmp/9router', 'db');

function command(args) {
  const child = spawn('litestream', args, { stdio: 'inherit', detached: true });
  return {
    done: once(child, 'exit').then(([code, signal]) => {
      if (code !== 0) throw new Error(`Litestream exited: ${code ?? signal}`);
    }),
    stop(signal) {
      if (child.pid && child.exitCode === null && child.signalCode === null) {
        if (signal === 'SIGKILL') process.kill(-child.pid, signal);
        else child.kill(signal);
      }
    },
  };
}

// Railway activates this waiting process before tearing down the old deployment.
// Keep its deploy healthcheck disabled: the new app cannot start until the old
// writer has flushed R2 and released this session-scoped Postgres lock.
export async function serve({
  client = new pg.Client({
    connectionString: process.env.DATABASE_URL,
    connectionTimeoutMillis: 10_000,
    query_timeout: 5_000,
    keepAlive: true,
  }),
  run = command,
  prepare = async () => {
    await rm(database(), { recursive: true, force: true });
    await mkdir(database(), { recursive: true });
  },
  signals = process,
} = {}) {
  let active;
  let heartbeat;
  let stopped = false;
  let failure;
  const stop = () => {
    stopped = true;
    if (active) active.stop('SIGTERM');
    else void client.end();
  };
  const lostLock = (error) => {
    failure = error;
    stopped = true;
    // A lost session cannot safely flush: another writer may already own R2.
    active?.stop('SIGKILL');
  };
  client.on('error', lostLock);
  signals.once('SIGTERM', stop);
  signals.once('SIGINT', stop);
  try {
    await client.connect();
    // Poll rather than queue a blocking query, so shutdown can interrupt waiting.
    while (!stopped) {
      const result = await client.query(
        'SELECT pg_try_advisory_lock(923, 20128) AS locked'
      );
      if (result.rows[0].locked) break;
      await new Promise((done) => setTimeout(done, 250));
    }
    if (stopped) return;
    heartbeat = setInterval(() => {
      void client.query('SELECT 1').catch(lostLock);
    }, 1000);
    await prepare();
    if (stopped) return;
    active = run([
      'restore',
      '-if-replica-exists',
      `${database()}/data.sqlite`,
    ]);
    await active.done;
    if (stopped) return;
    active = run(['replicate', '-exec', 'node /app/custom-server.js']);
    await active.done;
    if (failure) throw failure;
    // Re-open the final database after the app closes, including writes made
    // before Litestream's first polling cycle. Finish this before unlocking.
    active = run(['replicate', '-once']);
    await active.done;
  } catch (error) {
    if (!stopped || failure) throw error;
  } finally {
    clearInterval(heartbeat);
    signals.removeListener('SIGTERM', stop);
    signals.removeListener('SIGINT', stop);
    client.removeListener('error', lostLock);
    await client.end();
    if (failure) throw failure;
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const required = [
    'DATABASE_URL',
    'INITIAL_PASSWORD',
    'JWT_SECRET',
    'API_KEY_SECRET',
    'MACHINE_ID_SALT',
    'S3_BUCKET',
    'S3_ENDPOINT',
    'S3_REGION',
    'S3_ACCESS_KEY_ID',
    'S3_SECRET_ACCESS_KEY',
  ];
  if (required.some((name) => !process.env[name]))
    throw new Error('Missing required 9router runtime configuration');
  serve().catch(() => {
    console.error('9router stopped: lock, restore, or replication failed');
    process.exitCode = 1;
  });
}
