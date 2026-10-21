import type { SQL } from 'bun';
import type { Config } from './config';
import type { Configuration } from 'openid-client';
import type { Logger } from '@pkgs/logger';

export interface Dependencies {
  config: Config;
  db: SQL;
  oidc: Configuration;
  log?: Logger;
}
export interface Session {
  token_hash: string;
  subject: string;
  csrf: string;
  operator: boolean;
}
export type Context = { Variables: { session: Session; requestId: string } };
