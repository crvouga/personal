// Read-only access to the authentication relay's operator bootstrap state.
import { SQL } from 'bun';
import { schemaName, type RelayInstance } from './model';

export interface Store {
  operatorCount(): Promise<number>;
  close(): Promise<void>;
}

export function openStore(relay: RelayInstance, url: string): Store {
  const schema = schemaName(relay);
  const db = new SQL({ url, max: 2, connectionTimeout: 10, idleTimeout: 10 });
  return {
    async operatorCount() {
      const rows = await db.unsafe(
        `SELECT count(*)::int AS n FROM ${schema}.operators`
      );
      return Number(rows[0]?.n ?? 0);
    },
    async close() {
      await db.close();
    },
  };
}
