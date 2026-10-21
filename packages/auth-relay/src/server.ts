import { createLogger, errorDetails } from '@pkgs/logger';
import { configuration } from './config';
import type { Config } from './config';
import { database } from './db';
import { provider } from './oidc';
import { application } from './app';
import { maintenance } from './maintenance';
import { backgroundJob, relayLogger, step } from './telemetry';

async function start(config: Config) {
  const log = relayLogger(config);
  const db = database(config);
  log.info('service_starting', { runtime: Bun.version, databasePoolMax: 1 });
  const oidc = await step('startup.discovery', () => provider(config)).catch(
    async (error: unknown) => {
      await db.close();
      throw error;
    }
  );
  const app = application({ config, db, oidc, log });
  const server = Bun.serve({
    hostname: config.developmentIdentity ? '127.0.0.1' : '0.0.0.0',
    port: Number(process.env['PORT'] ?? 8080),
    fetch: app.fetch,
  });
  log.info('service_listening', { port: server.port });
  let job: Promise<void> | undefined;
  const timer = setInterval(() => {
    if (job) {
      log.warn('maintenance_skipped', { reason: 'previous_run_active' });
      return;
    }
    job = backgroundJob(log, () => maintenance({ config, db })).finally(() => {
      job = undefined;
    });
  }, 60000);
  let stopping = false;
  async function stop(signal: string) {
    if (stopping) return;
    stopping = true;
    clearInterval(timer);
    log.info('service_stopping', { signal });
    const deadline = setTimeout(() => {
      log.error('shutdown_deadline_exceeded', { deadlineMs: 25000 });
      process.exit(1);
    }, 25000);
    await server.stop(false);
    await job;
    await db.close();
    clearTimeout(deadline);
    log.info('service_stopped');
  }
  const shutdown = (signal: string) => {
    void stop(signal).catch((error: unknown) => {
      log.error('shutdown_failed', { error: errorDetails(error) });
      process.exit(1);
    });
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

try {
  await start(configuration());
} catch (error) {
  createLogger({ name: 'auth-relay' }).error('startup_failed', {
    error: errorDetails(error),
  });
  process.exitCode = 1;
}
