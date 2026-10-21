/**
 * Keeps the deploy-time `VAULT_TOKEN` alive for as long as the process runs.
 *
 * The runtime token is *periodic* (see `vault.tokens` in
 * `packages/infra/tofu/modules/inventory/inventory.tf.json`): its TTL resets to the period on every
 * `auth/token/renew-self`, but it still expires if nobody renews it. Without
 * this loop the cache silently dies one period after the last deploy — which
 * is exactly how it went down before. Renewing from inside the server means
 * uptime no longer depends on an external cron or a redeploy cadence.
 */
import { assert } from '@pkgs/assert';
import { createLogger, errorDetails, type Logger } from '@pkgs/logger';
import type { VaultFetch } from './vault-fetch';

const defaultLog = createLogger({ name: 'turbo-cache-token' });

const DEFAULT_ADDR = 'https://vault.chrisvouga.dev';
/** Never sleep longer than this, even for very long TTLs. */
const MAX_RENEW_INTERVAL_MS = 6 * 60 * 60 * 1000;
/** Never hammer Vault faster than this. */
const MIN_RENEW_INTERVAL_MS = 60_000;
/** Backoff when a renew attempt fails; retries stay frequent so short TTLs survive. */
const RETRY_INTERVAL_MS = 5 * 60 * 1000;
/** Used when Vault reports a TTL we cannot interpret. */
const FALLBACK_TTL_SECONDS = 3600;

export type VaultTokenRenewerOptions = {
  readonly token: string;
  readonly addr?: string | null;
  readonly fetchFn?: VaultFetch;
  readonly setTimeoutFn?: typeof setTimeout;
  readonly logger?: Logger;
};

type LookupResult = {
  readonly ttlSeconds: number;
  readonly renewable: boolean;
};

function normalizeAddr(addr: string | null | undefined): string {
  if (typeof addr !== 'string') return DEFAULT_ADDR;
  const trimmed = addr.trim();
  if (trimmed.length === 0) return DEFAULT_ADDR;
  return trimmed.replace(/\/$/, '');
}

/** Renew at half the remaining TTL so a single failed attempt is never fatal. */
export function renewIntervalMs(ttlSeconds: number): number {
  assert.ok(
    typeof ttlSeconds === 'number' && Number.isFinite(ttlSeconds),
    'renewIntervalMs requires a finite ttl'
  );
  const ttl = ttlSeconds > 0 ? ttlSeconds : FALLBACK_TTL_SECONDS;
  const half = Math.floor((ttl * 1000) / 2);
  return Math.min(Math.max(half, MIN_RENEW_INTERVAL_MS), MAX_RENEW_INTERVAL_MS);
}

function parseLookup(json: unknown): LookupResult {
  if (json === null || typeof json !== 'object') {
    return { ttlSeconds: FALLBACK_TTL_SECONDS, renewable: true };
  }
  const data = (json as { data?: unknown }).data;
  if (data === null || typeof data !== 'object') {
    return { ttlSeconds: FALLBACK_TTL_SECONDS, renewable: true };
  }
  const record = data as { ttl?: unknown; renewable?: unknown };
  const ttlSeconds =
    typeof record.ttl === 'number' && Number.isFinite(record.ttl)
      ? record.ttl
      : FALLBACK_TTL_SECONDS;
  // A root/never-expiring token reports ttl 0; treat it as renewable-irrelevant.
  const renewable = record.renewable !== false;
  return { ttlSeconds, renewable };
}

export class VaultTokenRenewer {
  private readonly token: string;
  private readonly addr: string;
  private readonly fetchFn: VaultFetch;
  private readonly setTimeoutFn: typeof setTimeout;
  private readonly log: Logger;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;

  constructor(options: VaultTokenRenewerOptions) {
    assert.record(options, 'VaultTokenRenewer requires options');
    assert.nonEmptyString(options.token, 'VaultTokenRenewer requires token');
    this.token = options.token;
    this.addr = normalizeAddr(options.addr);
    this.fetchFn =
      options.fetchFn ?? ((input, init) => globalThis.fetch(input, init));
    this.setTimeoutFn = options.setTimeoutFn ?? setTimeout;
    this.log = options.logger ?? defaultLog;
    assert.nonEmptyString(this.addr, 'VaultTokenRenewer requires addr');
  }

  /** Renew once immediately, then reschedule based on the resulting TTL. */
  async start(): Promise<void> {
    await this.tick();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private schedule(delayMs: number): void {
    assert.ok(delayMs > 0, 'schedule requires a positive delay');
    if (this.stopped) return;
    this.timer = this.setTimeoutFn(() => {
      void this.tick();
    }, delayMs);
    // Do not hold the process open solely for the renew timer.
    const timer = this.timer as { unref?: () => void } | null;
    if (timer !== null && typeof timer.unref === 'function') timer.unref();
  }

  private async tick(): Promise<void> {
    if (this.stopped) return;
    try {
      const lookup = await this.renewSelf();
      if (!lookup.renewable) {
        this.log.info('vault token is not renewable; renewal loop stopped', {
          ttlSeconds: lookup.ttlSeconds,
        });
        this.stop();
        return;
      }
      const delayMs = renewIntervalMs(lookup.ttlSeconds);
      this.log.info('vault token renewed', {
        ttlSeconds: lookup.ttlSeconds,
        nextRenewInSeconds: Math.round(delayMs / 1000),
      });
      this.schedule(delayMs);
    } catch (err: unknown) {
      this.log.warn('vault token renewal failed; will retry', {
        error: errorDetails(err),
        retryInMs: RETRY_INTERVAL_MS,
      });
      this.schedule(RETRY_INTERVAL_MS);
    }
  }

  private async renewSelf(): Promise<LookupResult> {
    const response = await this.fetchFn(
      `${this.addr}/v1/auth/token/renew-self`,
      {
        method: 'POST',
        headers: {
          'X-Vault-Token': this.token,
          Accept: 'application/json',
        },
      }
    );
    assert.defined(response, 'renewSelf requires a response');
    if (!response.ok) {
      throw new Error(`token renew-self failed: HTTP ${response.status}`);
    }
    let json: unknown = null;
    try {
      json = await response.json();
    } catch {
      json = null;
    }
    return parseRenew(json);
  }
}

function parseRenew(json: unknown): LookupResult {
  if (json === null || typeof json !== 'object') {
    return { ttlSeconds: FALLBACK_TTL_SECONDS, renewable: true };
  }
  const auth = (json as { auth?: unknown }).auth;
  if (auth === null || typeof auth !== 'object') {
    return parseLookup(json);
  }
  const record = auth as { lease_duration?: unknown; renewable?: unknown };
  const ttlSeconds =
    typeof record.lease_duration === 'number' &&
    Number.isFinite(record.lease_duration)
      ? record.lease_duration
      : FALLBACK_TTL_SECONDS;
  const renewable = record.renewable !== false;
  return { ttlSeconds, renewable };
}
