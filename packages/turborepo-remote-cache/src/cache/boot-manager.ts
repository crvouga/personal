import { assert } from '@pkgs/assert';
import { createLogger, errorDetails, type Logger } from '@pkgs/logger';
import {
  isSecretStoreError,
  SecretStoreRequestError,
} from '@pkgs/secret-store';
import { loadCacheBootConfig } from '../config/boot-config';
import {
  assertVaultToken,
  type CacheServerEnv,
  ConfigurationError,
  readVaultScopeBindings,
} from '../config/env';
import { createCacheSecretStore } from '../config/secret-store';
import type { VaultFetch } from '../config/vault-fetch';
import { createCacheApp } from './create-app';

const defaultLog = createLogger({ name: 'turbo-cache' });

type App = ReturnType<typeof createCacheApp>;

/** Injection seam: a fake Vault transport and clock keep boot tests offline. */
export type CacheBootDeps = {
  readonly fetchFn?: VaultFetch;
  readonly now?: () => number;
  readonly logger?: Logger;
};

type BootState =
  | { readonly kind: 'pending' }
  | { readonly kind: 'ready'; readonly app: App }
  | { readonly kind: 'fatal'; readonly reason: string };

/** Floor between boot retries so a hard-down Vault is not hammered per request. */
const RETRY_COOLDOWN_MS = 5_000;

/**
 * Auth failures are recoverable: Vault can reject reads while a token is being
 * rotated, a policy is being reapplied, or the cluster is briefly sealed.
 * Latching fatal on those turned a transient 403 into permanent downtime.
 */
function isRecoverableVaultBootError(err: unknown): boolean {
  if (!(err instanceof SecretStoreRequestError)) return false;
  const status = err.status;
  if (status === undefined) return true;
  if (status === 401 || status === 403) return true;
  return status === 429 || status === 530 || (status >= 500 && status <= 504);
}

async function bootApp(env: CacheServerEnv, deps: CacheBootDeps): Promise<App> {
  assert.record(env, 'bootApp requires env');
  assert.record(deps, 'bootApp requires deps');
  const token = assertVaultToken(env);
  assert.nonEmptyString(token, 'bootApp requires vault token');
  const { addr, project, config } = readVaultScopeBindings(env);
  const secretStore = createCacheSecretStore(token, {
    addr,
    project,
    config,
    fetchFn: deps.fetchFn ?? null,
  });
  assert.defined(secretStore, 'bootApp requires secret store');
  const bootConfig = await loadCacheBootConfig(secretStore);
  assert.nonEmptyString(
    bootConfig.turboToken,
    'bootConfig requires turboToken'
  );
  assert.defined(bootConfig.objectStore, 'bootConfig requires objectStore');
  return createCacheApp({ ...bootConfig, logger: deps.logger ?? defaultLog });
}

export class CacheBootManager {
  private bootState: BootState = { kind: 'pending' };
  private fatalLogged = false;
  private lastError: string | null = null;
  private nextAttemptAtMs = 0;
  private inflight: Promise<App | null> | null = null;

  constructor(
    private readonly env: CacheServerEnv,
    private readonly deps: CacheBootDeps = {}
  ) {
    assert.record(this.env, 'CacheBootManager requires env');
    assert.record(this.deps, 'CacheBootManager requires deps');
  }

  private nowMs(): number {
    return (this.deps.now ?? Date.now)();
  }

  private get log(): Logger {
    return this.deps.logger ?? defaultLog;
  }

  /** Reason to surface in the 503 body: fatal reason, else last boot error. */
  fatalReason(): string | null {
    if (this.bootState.kind === 'fatal') return this.bootState.reason;
    return this.lastError;
  }

  private latchFatal(reason: string): void {
    assert.nonEmptyString(reason, 'latchFatal requires reason');
    this.bootState = { kind: 'fatal', reason };
    if (!this.fatalLogged) {
      this.log.error(`cache fatal: refusing to serve: ${reason}`, { reason });
      this.fatalLogged = true;
    }
  }

  async ensureApp(): Promise<App | null> {
    if (this.bootState.kind === 'ready') return this.bootState.app;
    if (this.bootState.kind === 'fatal') return null;
    assert.equals(this.bootState.kind, 'pending', 'boot state must be pending');

    if (this.inflight !== null) return this.inflight;
    if (this.nowMs() < this.nextAttemptAtMs) return null;

    const attempt = this.attemptBoot().finally(() => {
      this.inflight = null;
    });
    this.inflight = attempt;
    return attempt;
  }

  private async attemptBoot(): Promise<App | null> {
    try {
      const app = await bootApp(this.env, this.deps);
      assert.defined(app, 'bootApp must return app');
      this.bootState = { kind: 'ready', app };
      this.lastError = null;
      return app;
    } catch (err: unknown) {
      if (err instanceof ConfigurationError) {
        this.latchFatal(err.message);
        return null;
      }
      if (isRecoverableVaultBootError(err)) {
        const message = err instanceof Error ? err.message : String(err);
        this.lastError = message;
        this.nextAttemptAtMs = this.nowMs() + RETRY_COOLDOWN_MS;
        this.log.warn('cache boot vault error; will retry', {
          error: errorDetails(err),
          retryInMs: RETRY_COOLDOWN_MS,
        });
        return null;
      }
      if (isSecretStoreError(err)) {
        this.latchFatal(err instanceof Error ? err.message : String(err));
        return null;
      }
      throw err;
    }
  }
}
