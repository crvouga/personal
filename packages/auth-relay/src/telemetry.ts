import {
  createLogger,
  errorDetails,
  operation,
  withLogContext,
} from '@pkgs/logger';
import type { Logger } from '@pkgs/logger';
import type { Config } from './config';

export function relayLogger(config: Config): Logger {
  return createLogger({ name: 'auth-relay', level: 'info' }).child({
    environment: config.environment,
    realm: config.realm,
    deployment: process.env['RAILWAY_DEPLOYMENT_ID'],
    replica: process.env['RAILWAY_REPLICA_ID'],
    revision: process.env['RAILWAY_GIT_COMMIT_SHA'],
  });
}

export async function step<T>(
  name: string,
  work: () => PromiseLike<T>
): Promise<T> {
  return operation(name, work);
}

export async function backgroundJob(
  log: Logger,
  work: () => Promise<void>
): Promise<void> {
  const started = performance.now();
  await withLogContext(
    { jobId: crypto.randomUUID(), job: 'maintenance' },
    async () => {
      try {
        await work();
        log.info('maintenance_completed', {
          durationMs: Math.round(performance.now() - started),
        });
      } catch (error) {
        log.error('maintenance_failed', {
          durationMs: Math.round(performance.now() - started),
          retryInMs: 60000,
          error: errorDetails(error),
        });
      }
    }
  );
}
