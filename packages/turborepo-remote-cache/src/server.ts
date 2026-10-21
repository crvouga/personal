import { Assert, ThrowingCrashHandler, assert } from '@pkgs/assert';
import { createLogger, errorDetails, type Logger } from '@pkgs/logger';

import { CacheBootManager } from './cache/boot-manager';
import {
  readCacheServerEnv,
  readVaultScopeBindings,
  type CacheServerEnv,
} from './config/env';
import { VaultTokenRenewer } from './config/token-renewer';
import type { VaultFetch } from './config/vault-fetch';

Assert.registerCrashHandler(new ThrowingCrashHandler());

const defaultLog = createLogger({ name: 'turbo-cache' });

const ERROR_CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
} as const;

function preflightResponse(request: Request): Response {
  assert.ok(request instanceof Request, 'preflight requires Request');
  const requested = request.headers.get('Access-Control-Request-Headers');
  const allowHeaders =
    requested !== null && requested.trim().length > 0
      ? requested
      : 'Authorization, Content-Type, x-artifact-tag';
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, HEAD, PUT, POST, OPTIONS',
      'Access-Control-Allow-Headers': allowHeaders,
    },
  });
}

function fatalConfigResponse(reason: string): Response {
  assert.nonEmptyString(reason, 'fatalConfigResponse requires reason');
  return new Response(
    JSON.stringify({ error: 'cache misconfigured', reason }),
    {
      status: 503,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
        ...ERROR_CORS_HEADERS,
      },
    }
  );
}

function internalErrorResponse(): Response {
  return new Response(JSON.stringify({ error: 'Internal server error' }), {
    status: 500,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      ...ERROR_CORS_HEADERS,
    },
  });
}

function healthResponse(method: string): Response | null {
  assert.nonEmptyString(method, 'healthResponse requires method');
  if (method === 'HEAD') {
    return new Response(null, {
      status: 200,
      headers: { ...ERROR_CORS_HEADERS },
    });
  }
  if (method === 'GET') {
    return new Response(JSON.stringify({ status: 'ok' as const }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        ...ERROR_CORS_HEADERS,
      },
    });
  }
  assert.ok(
    method !== 'HEAD' && method !== 'GET',
    'healthResponse null is valid for non-HEAD/GET'
  );
  return null;
}

/**
 * Injection seam for the whole server: a fake Vault transport plus a virtual
 * clock let tests exercise months of uptime offline and deterministically.
 */
export type CacheServerDeps = {
  readonly fetchFn?: VaultFetch;
  readonly now?: () => number;
  readonly setTimeoutFn?: typeof setTimeout;
  /** Swap for a silent logger to keep test output readable. */
  readonly logger?: Logger;
};

export type CacheServer = {
  fetch: (request: Request) => Promise<Response>;
  /** Begins Vault token renewal. Explicit so building a server starts nothing. */
  start: () => Promise<void>;
  stop: () => void;
};

export function createCacheRequestHandler(
  env: CacheServerEnv,
  deps: CacheServerDeps = {}
): CacheServer {
  assert.record(env, 'createCacheRequestHandler requires env');
  assert.record(deps, 'createCacheRequestHandler requires deps');
  const log = deps.logger ?? defaultLog;
  const boot = new CacheBootManager(env, {
    ...(deps.fetchFn !== undefined ? { fetchFn: deps.fetchFn } : {}),
    ...(deps.now !== undefined ? { now: deps.now } : {}),
    ...(deps.logger !== undefined ? { logger: deps.logger } : {}),
  });
  assert.defined(boot, 'createCacheRequestHandler requires boot manager');

  // Keeps the periodic VAULT_TOKEN from expiring while the server runs.
  const renewer = new VaultTokenRenewer({
    token: env.VAULT_TOKEN,
    addr: readVaultScopeBindings(env).addr,
    ...(deps.fetchFn !== undefined ? { fetchFn: deps.fetchFn } : {}),
    ...(deps.setTimeoutFn !== undefined
      ? { setTimeoutFn: deps.setTimeoutFn }
      : {}),
    ...(deps.logger !== undefined ? { logger: deps.logger } : {}),
  });

  async function fetch(request: Request): Promise<Response> {
    assert.ok(request instanceof Request, 'fetch handler requires Request');
    try {
      const url = new URL(request.url);

      if (url.pathname === '/health') {
        const response = healthResponse(request.method);
        if (response !== null) return response;
      }

      if (request.method === 'OPTIONS') {
        return preflightResponse(request);
      }

      const app = await boot.ensureApp();
      if (app === null) {
        return fatalConfigResponse(boot.fatalReason() ?? 'unknown');
      }

      return app.fetch(request);
    } catch (err: unknown) {
      log.error('top-level handler error', { error: errorDetails(err) });

      if (request.method === 'OPTIONS') {
        return preflightResponse(request);
      }

      return internalErrorResponse();
    }
  }

  return {
    fetch,
    start: () => renewer.start(),
    stop: () => {
      renewer.stop();
    },
  };
}

export async function startServer(
  env: CacheServerEnv = readCacheServerEnv()
): Promise<void> {
  assert.record(env, 'startServer requires env');
  assert.nonNegativeInteger(env.PORT, 'startServer requires valid PORT');
  const handler = createCacheRequestHandler(env);
  assert.defined(handler, 'startServer requires handler');

  // Fire-and-forget: renewal failures are logged and retried, and must never
  // stop the server from serving traffic.
  void handler.start();

  defaultLog.info('cache server listening', {
    port: env.PORT,
    vaultConfig: env.VAULT_CONFIG ?? 'dev',
  });

  Bun.serve({
    hostname: '0.0.0.0',
    port: env.PORT,
    fetch: (request) => handler.fetch(request),
  });
}

if (import.meta.main) {
  startServer().catch((err: unknown) => {
    defaultLog.error('cache server failed to start', {
      error: errorDetails(err),
    });
    process.exit(1);
  });
}
