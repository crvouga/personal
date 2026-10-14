import type { Logger } from '@pkgs/logger';
import type { Context } from 'hono';
import { getCookie } from 'hono/cookie';

import type { AdminAuth, AppEnv, LoginResult } from '../deps';

import { safeEqual } from './hash';
import {
  SESSION_COOKIE,
  SESSION_SECONDS,
  clearedSessionCookie,
  sessionCookie,
  signSession,
  verifySession,
} from './session';
import { vaultAdminLogin } from './vault-login';

export const TOKEN_ACTOR = 'admin-token';

export interface AdminAuthOptions {
  readonly env: Pick<AppEnv, 'adminToken' | 'sessionSecret' | 'vaultAddr'>;
  readonly now: () => Date;
  readonly fetch: typeof fetch;
  readonly log: Logger;
  readonly vaultTimeoutMs?: number;
}

function bearerToken(c: Context): string | null {
  const header = c.req.header('authorization');
  if (header === undefined || !header.startsWith('Bearer ')) return null;
  return header.slice('Bearer '.length).trim();
}

function hostOf(value: string | undefined): string | null {
  if (value === undefined || value === 'null') return null;
  try {
    return new URL(value).host;
  } catch {
    return null;
  }
}

function requestHosts(c: Context): string[] {
  const hosts = [c.req.header('host'), new URL(c.req.url).host];
  const forwarded = c.req.header('x-forwarded-host')?.split(',')[0]?.trim();
  if (forwarded !== undefined && forwarded.length > 0) hosts.push(forwarded);
  return hosts.filter((h): h is string => typeof h === 'string');
}

export class FleetAdminAuth implements AdminAuth {
  constructor(private readonly options: AdminAuthOptions) {}

  async actor(c: Context): Promise<string | null> {
    const token = bearerToken(c);
    if (token !== null && safeEqual(token, this.options.env.adminToken)) {
      return TOKEN_ACTOR;
    }
    const nowSeconds = Math.floor(this.options.now().getTime() / 1000);
    return verifySession(
      this.options.env.sessionSecret,
      getCookie(c, SESSION_COOKIE),
      nowSeconds
    );
  }

  async login(username: string, password: string): Promise<LoginResult | null> {
    const { env, fetch, log, vaultTimeoutMs } = this.options;
    const ok = await vaultAdminLogin(
      {
        vaultAddr: env.vaultAddr,
        fetch,
        log,
        ...(vaultTimeoutMs !== undefined ? { timeoutMs: vaultTimeoutMs } : {}),
      },
      username,
      password
    );
    if (!ok) return null;
    const expires =
      Math.floor(this.options.now().getTime() / 1000) + SESSION_SECONDS;
    const value = signSession(env.sessionSecret, username, expires);
    return { cookie: sessionCookie(value), actor: username };
  }

  logoutCookie(): string {
    return clearedSessionCookie();
  }

  /** Origin, else Referer, must name this site. Absent both: refuse. */
  sameOrigin(c: Context): boolean {
    const origin = c.req.header('origin');
    const claimed = hostOf(origin ?? c.req.header('referer'));
    if (claimed === null) return false;
    return requestHosts(c).includes(claimed);
  }
}
