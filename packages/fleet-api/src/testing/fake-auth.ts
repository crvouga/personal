import type { Context } from 'hono';
import { getCookie } from 'hono/cookie';

import type { AdminAuth, LoginResult } from '../deps';

const COOKIE = 'fleet_session';
export const FAKE_PASSWORD = 'correct horse';

export interface FakeAuthOptions {
  /** Every request is treated as this person; used by the design demo. */
  readonly alwaysSignedInAs?: string;
}

/** Cookie `fleet_session=ok:<name>` signs a person in. Password is FAKE_PASSWORD. */
export function createFakeAuth(options: FakeAuthOptions = {}): AdminAuth {
  return {
    async actor(c: Context): Promise<string | null> {
      if (options.alwaysSignedInAs !== undefined)
        return options.alwaysSignedInAs;
      const cookie = getCookie(c, COOKIE);
      return cookie?.startsWith('ok:') === true ? cookie.slice(3) : null;
    },
    async login(
      username: string,
      password: string
    ): Promise<LoginResult | null> {
      if (password !== FAKE_PASSWORD || username === '') return null;
      return {
        cookie: `${COOKIE}=ok:${username}; Path=/; HttpOnly; SameSite=Lax`,
        actor: username,
      };
    },
    logoutCookie(): string {
      return `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
    },
    sameOrigin(c: Context): boolean {
      const origin = c.req.header('origin');
      if (origin === undefined) return false;
      try {
        return new URL(origin).host === new URL(c.req.url).host;
      } catch {
        return false;
      }
    },
  };
}
