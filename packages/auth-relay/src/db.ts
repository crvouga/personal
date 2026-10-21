import { SQL } from 'bun';
import type { Config } from './config';

export function database(config: Config): SQL {
  return new SQL({
    url: config.database,
    // Four gateways share a small cluster with Keycloak, Vault and other apps.
    // Serialize each replica's queries and release idle connections so sign-in
    // bursts cannot reserve twelve slots just for the consoles.
    max: 1,
    connectionTimeout: 5,
    idleTimeout: 10,
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
