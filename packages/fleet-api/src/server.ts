import { createLogger, type Logger } from '@pkgs/logger';

import { createApi } from './app';
import { FleetAdminAuth } from './auth/admin-auth';
import { createDb } from './db/client';
import { PgStore } from './db/pg-store';
import type { AppDeps } from './deps';
import { ConfigurationError, readServerEnv, type ServerEnv } from './env';
import { startJobs } from './jobs/scheduler';
import { GithubRevisionSource } from './revisions/github';
import { mountUi } from './routes/ui';

const SHUTDOWN_GRACE_MS = 10_000;

export interface RunningServer {
  readonly port: number;
  stop(): Promise<void>;
}

/** Wires the real database, Vault login, GitHub lookup and clock into AppDeps. */
export function buildDeps(
  env: ServerEnv,
  store: PgStore,
  log: Logger
): AppDeps {
  const now = () => new Date();
  return {
    store,
    auth: new FleetAdminAuth({ env, now, fetch, log }),
    revisions: new GithubRevisionSource({
      repo: env.githubRepo,
      fetch,
      now,
      log,
    }),
    env,
    now,
  };
}

/** Boots the HTTP server and the background jobs. Names no secret in any log. */
export async function startServer(
  env: ServerEnv,
  log: Logger
): Promise<RunningServer> {
  const db = createDb({ url: env.databaseUrl, prepare: env.databasePrepare });
  const store = new PgStore(db);
  const deps = buildDeps(env, store, log);
  const app = createApi(deps, { log });
  mountUi(app, deps);
  try {
    await store.health();
  } catch {
    log.error(
      'database is not reachable yet; /health will answer 503 until it is'
    );
  }
  const jobs = startJobs({ store, now: deps.now, fetch, log });
  const server = Bun.serve({
    hostname: '0.0.0.0',
    port: env.port,
    fetch: (request, bunServer) => app.fetch(request, { server: bunServer }),
  });
  log.info('fleet api listening', { port: server.port });
  return {
    port: server.port ?? env.port,
    stop: async () => {
      jobs.stop();
      await server.stop();
      await db.close();
    },
  };
}

function shutdownOn(running: RunningServer, log: Logger): void {
  let stopping = false;
  const handler = (signal: string) => {
    if (stopping) return;
    stopping = true;
    log.info('shutting down', { signal });
    setTimeout(() => process.exit(1), SHUTDOWN_GRACE_MS).unref();
    running
      .stop()
      .then(() => process.exit(0))
      .catch((err: unknown) => {
        log.error('shutdown failed', { error: String(err) });
        process.exit(1);
      });
  };
  process.on('SIGTERM', () => handler('SIGTERM'));
  process.on('SIGINT', () => handler('SIGINT'));
}

async function main(): Promise<void> {
  const log = createLogger({ name: 'fleet-api', level: 'info' });
  try {
    const running = await startServer(readServerEnv(), log);
    shutdownOn(running, log);
  } catch (err: unknown) {
    // Only configuration errors are known to be free of secrets.
    const message =
      err instanceof ConfigurationError ? err.message : 'startup failed';
    log.error('fleet api failed to start', {
      error: message,
      kind: err instanceof Error ? err.name : 'unknown',
    });
    process.exit(1);
  }
}

if (import.meta.main) {
  void main();
}
