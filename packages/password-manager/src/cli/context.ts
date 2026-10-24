import { createLogger } from '@pkgs/logger';
import type { Command } from 'commander';
import { join } from 'node:path';
import { SqliteState } from '../adapters/state.ts';
import { OsSecrets } from '../adapters/keychain.ts';
import { readConfig } from '../adapters/config-file.ts';
import { BitwardenVault } from '../adapters/bitwarden.ts';
import { stateDirectory } from '../adapters/paths.ts';
import { runtime } from '../adapters/runtime.ts';
import { GithubSite } from '../adapters/github-site.ts';
import { ManagerError, safeCode } from '../domain/errors.ts';
import type { WorkflowContext } from '../domain/ports.ts';
export interface Options {
  json?: boolean;
  nonInteractive?: boolean;
  stateDir?: string;
}
export function location(program: Command): string {
  return program.opts<Options>().stateDir ?? stateDirectory();
}
export function openContext(program: Command) {
  const directory = location(program);
  const state = new SqliteState(directory);
  const config = readConfig(directory);
  const secrets = new OsSecrets(config.secretService);
  const vault = config.bitwarden
    ? new BitwardenVault({
        directory: join(directory, 'bitwarden'),
        expected: config.bitwarden,
        secrets,
      })
    : null;
  const context = {
    controller: new AbortController(),
    directory,
    state,
    secrets,
    config,
    vault,
    runtime,
    interactive: process.stdin.isTTY && !program.opts<Options>().nonInteractive,
  };
  return context;
}
export type AppContext = ReturnType<typeof openContext>;
export function workflow(app: AppContext): WorkflowContext {
  if (!app.vault) throw new ManagerError('not-authenticated');
  return {
    ...app,
    vault: app.vault,
    sources: app.config.sources,
    secretService: app.config.secretService,
    vaultIdentity: app.config.bitwarden
      ? {
          server: app.config.bitwarden.server,
          email: app.config.bitwarden.email,
        }
      : null,
    maxAttempts: app.config.execution.maxAttempts,
    interactive: Boolean(app.interactive),
    cancelled: () => app.controller.signal.aborted,
    site: async (origin, accountId) => {
      if (origin !== 'https://github.com')
        throw new ManagerError('unsupported-capability');
      return new GithubSite({
        accountId,
        secrets: app.secrets,
        headless: !app.interactive,
      });
    },
  };
}
export async function unlocked<T>(
  app: AppContext,
  work: () => Promise<T>
): Promise<T> {
  if (!app.vault) return work();
  return app.state.withLock('bitwarden-session', async () => {
    const ref = app.config.bitwarden?.masterPasswordRef;
    try {
      if (ref)
        await app.vault!.unlock(
          (await app.secrets.getRequired(ref)).readSecretValue()
        );
      else if (app.interactive) {
        const { password } = await import('@inquirer/prompts');
        await app.vault!.unlock(
          await password({
            message: 'Bitwarden master password (not saved):',
            mask: true,
          })
        );
      }
    } catch {
      /* A locked vault blocks its operations; independent sources continue. */
    }
    try {
      return await work();
    } finally {
      await app.vault!.close();
    }
  });
}
export function emit(value: unknown): void {
  // Callers supply domain/report DTOs only. Never invoke on adapter responses.
  process.stdout.write(JSON.stringify(value, null, 2) + '\n');
}
export function action(
  program: Command,
  work: (app: AppContext) => Promise<unknown>
): () => Promise<void> {
  return async () => {
    let app: AppContext | null = null;
    const cancel = () => app?.controller.abort();
    try {
      app = openContext(program);
      process.once('SIGINT', cancel);
      process.once('SIGTERM', cancel);
      const result = await work(app);
      emit(result);
      process.exitCode = resultExitCode(result);
    } catch (error) {
      const code = safeCode(error);
      if (code !== 'cancelled')
        createLogger({ name: 'password-manager' }).error('command_failed', {
          errorCode: code,
        });
      emit({
        status: code === 'cancelled' ? 'cancelled' : 'failed',
        error: code,
      });
      process.exitCode = code === 'cancelled' ? 3 : 1;
    } finally {
      process.off('SIGINT', cancel);
      process.off('SIGTERM', cancel);
      app?.state.close();
    }
  };
}

export function resultExitCode(value: unknown): number {
  if (!value || typeof value !== 'object') return 0;
  const report = value as { status?: string; state?: string; error?: string };
  if (report.error === 'busy') return 3;
  const status = report.status ?? report.state;
  if (status === 'failed') return 1;
  if (status === 'requires-user-action' || status === 'requires_user_action')
    return 2;
  if (
    [
      'partial',
      'outcome_unknown',
      'reconciliation_required',
      'cancelled',
    ].includes(status ?? '')
  )
    return 3;
  return 0;
}
