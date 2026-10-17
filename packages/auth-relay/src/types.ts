import type { SQL } from 'bun';
import type { Config } from './config';
import type { Configuration } from 'openid-client';

export interface Dependencies {
  config: Config;
  db: SQL;
  oidc: Configuration;
}
export interface Session {
  token_hash: string;
  subject: string;
  csrf: string;
  operator: boolean;
}
export type Context = { Variables: { session: Session } };
