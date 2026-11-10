import { syncWorkerGithub } from './worker-github';
/** Private scheduled job. The worker retains its own token; raw auth output is never logged. */
import { spawnSync } from 'node:child_process';
import { createLogger } from '../../packages/logger/src';
import { resolveVaultConfig } from '../../packages/fleet/src/vault-config';

export function renewWorkerVault(
  run: (args: string[]) => { status: number | null; stdout: string | null } = (
    args: string[]
  ) => spawnSync(args[0]!, args.slice(1), { encoding: 'utf8', timeout: 30_000 })
): boolean {
  const { addr } = resolveVaultConfig();
  const result = run([
    'vault',
    'token',
    'renew',
    `-address=${addr}`,
    '-format=json',
    '-increment=24h',
  ]);
  if (result.status !== 0) return false;
  try {
    const data: unknown = JSON.parse(result.stdout ?? '');
    return (
      typeof data === 'object' &&
      data !== null &&
      'auth' in data &&
      typeof data.auth === 'object' &&
      data.auth !== null &&
      'lease_duration' in data.auth &&
      typeof data.auth.lease_duration === 'number' &&
      data.auth.lease_duration > 0
    );
  } catch {
    return false;
  }
}
if (import.meta.main) {
  const log = createLogger({ name: 'personal-worker-auth', level: 'info' });
  const started = Date.now();
  log.info('job_started', {
    jobId: 'vault-self-renewal',
    operation: 'vault.token.renew',
  });
  const vault = renewWorkerVault();
  const github = vault && syncWorkerGithub();
  const ok = vault && github;
  log.info('job_finished', {
    jobId: 'vault-self-renewal',
    operation: 'vault.token.renew',
    vaultAuthenticated: vault,
    githubAuthenticated: github,
    outcome: ok ? 'success' : 'authentication_required',
    durationMs: Date.now() - started,
    retryDelayMs: 600000,
  });
  process.exitCode = ok ? 0 : 1;
}
