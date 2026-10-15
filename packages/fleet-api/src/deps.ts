import type { Context } from 'hono';

import type { Store } from './store';
import type { Role } from './types';

/** Everything read from the environment, parsed once at boot. */
export interface AppEnv {
  /** Bearer token for scripts and CI (`bun run health`). */
  readonly adminToken: string;
  /** Signs dashboard session cookies. */
  readonly sessionSecret: string;
  /** sha256 hex of each role's shared token; a node that presents the token is auto-approved. */
  readonly roleTokenHashes: Readonly<Partial<Record<Role, string>>>;
  /** Vault address used to check a person's username and password. Null disables password login. */
  readonly vaultAddr: string | null;
  /** owner/name whose main branch defines "latest". */
  readonly githubRepo: string;
}

export interface LoginResult {
  /** The Set-Cookie header value. */
  readonly cookie: string;
  readonly actor: string;
}

/** Who is making an administrative request. Implemented in src/auth. */
export interface AdminAuth {
  /** The actor for a Bearer token or a valid session cookie, else null. */
  actor(c: Context): Promise<string | null>;
  login(username: string, password: string): Promise<LoginResult | null>;
  /** A Set-Cookie header value that clears the session. */
  logoutCookie(): string;
  /** True when a state-changing request came from this site (Origin check). */
  sameOrigin(c: Context): boolean;
}

/** The newest commit on main, for "behind" badges. Cached by the implementation. */
export interface RevisionSource {
  latest(): Promise<string | null>;
}

export interface AppDeps {
  readonly store: Store;
  readonly auth: AdminAuth;
  readonly revisions: RevisionSource;
  readonly env: AppEnv;
  readonly now: () => Date;
}
