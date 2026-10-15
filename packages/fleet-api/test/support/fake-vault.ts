import type { Logger } from '@pkgs/logger';

export interface VaultCall {
  readonly path: string;
  readonly method: string;
  readonly token: string | null;
  readonly body: unknown;
}

export type VaultMode =
  'normal' | 'error' | 'garbage' | 'redirect' | 'hang' | 'no-policies';

export interface FakeVault {
  readonly url: string;
  readonly calls: VaultCall[];
  mode: VaultMode;
  /** When true, revoke-self answers 500. */
  failRevoke: boolean;
  stop(): void;
}

const USERS: Readonly<
  Record<string, { password: string; policies: string[] }>
> = {
  chris: { password: 'correct horse', policies: ['default', 'admin'] },
  'ops.bob': { password: 'bob-password', policies: ['default'] },
};

interface VaultState {
  mode: VaultMode;
  failRevoke: boolean;
}

async function login(
  state: VaultState,
  username: string,
  body: { password?: string }
): Promise<Response> {
  if (state.mode === 'error') return new Response('boom', { status: 500 });
  if (state.mode === 'garbage')
    return new Response('<html>not json</html>', { status: 200 });
  if (state.mode === 'redirect') {
    return new Response(null, {
      status: 307,
      headers: { Location: '/v1/evil' },
    });
  }
  if (state.mode === 'hang') return new Promise<Response>(() => undefined);
  const user = USERS[username];
  if (user === undefined || user.password !== body.password) {
    return Response.json(
      { errors: ['invalid username or password'] },
      { status: 400 }
    );
  }
  if (state.mode === 'no-policies')
    return Response.json({ auth: { client_token: 'tok-no-policies' } });
  return Response.json({
    auth: {
      client_token: `tok-${username}`,
      policies: user.policies,
      lease_duration: 3600,
    },
  });
}

async function route(
  state: VaultState,
  calls: VaultCall[],
  request: Request
): Promise<Response> {
  const url = new URL(request.url);
  const text = await request.text();
  const body: unknown = text.length > 0 ? JSON.parse(text) : null;
  calls.push({
    path: url.pathname,
    method: request.method,
    token: request.headers.get('x-vault-token'),
    body,
  });
  const match = /^\/v1\/auth\/userpass\/login\/(.+)$/.exec(url.pathname);
  if (request.method === 'POST' && match?.[1] !== undefined) {
    return login(
      state,
      decodeURIComponent(match[1]),
      (body ?? {}) as { password?: string }
    );
  }
  if (
    request.method === 'POST' &&
    url.pathname === '/v1/auth/token/revoke-self'
  ) {
    return state.failRevoke
      ? new Response('no', { status: 500 })
      : new Response(null, { status: 204 });
  }
  return new Response('not found', { status: 404 });
}

/** A stand-in for Vault's userpass login and token revoke-self endpoints. */
export function startFakeVault(): FakeVault {
  const calls: VaultCall[] = [];
  const state: VaultState = { mode: 'normal', failRevoke: false };
  const server = Bun.serve({
    port: 0,
    hostname: '127.0.0.1',
    fetch: (request) => route(state, calls, request),
  });
  return {
    url: `http://127.0.0.1:${server.port}`,
    calls,
    get mode() {
      return state.mode;
    },
    set mode(value: VaultMode) {
      state.mode = value;
    },
    get failRevoke() {
      return state.failRevoke;
    },
    set failRevoke(value: boolean) {
      state.failRevoke = value;
    },
    stop: () => {
      void server.stop(true);
    },
  };
}

/** A logger that remembers everything, so tests can prove what was never logged. */
export function recordingLogger(): Logger & { readonly lines: string[] } {
  const lines: string[] = [];
  const make = (
    bindings: Record<string, unknown>
  ): Logger & { readonly lines: string[] } => {
    const write =
      (level: string) => (msg: string, context?: Record<string, unknown>) => {
        lines.push(JSON.stringify({ level, msg, ...bindings, ...context }));
      };
    return {
      lines,
      debug: write('debug'),
      info: write('info'),
      warn: write('warn'),
      error: write('error'),
      child: (extra) => make({ ...bindings, ...extra }),
    };
  };
  return make({});
}
