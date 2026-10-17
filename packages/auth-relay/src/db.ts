import { SQL } from 'bun';
import type { Config } from './config';

export function database(config: Config): SQL {
  return new SQL({
    url: config.database,
    max: 8,
    connectionTimeout: 5,
    idleTimeout: 30,
  });
}

export function digest(value: string): string {
  return new Bun.CryptoHasher('sha256').update(value).digest('hex');
}

export function random(): string {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString(
    'base64url'
  );
}
