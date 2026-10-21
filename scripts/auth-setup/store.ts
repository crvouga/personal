// Read-mostly access to the two runtime databases the setup touches. Both URLs
// come from the operator's own Vault login and are never printed. Registration
// rows are runtime data owned by the relay; the only write here is the Fleet
// access list, which the docs reserve for the database owner.
import { SQL } from 'bun';
import { FLEET_IDENTITY, schemaName, type RelayInstance } from './model';

export type FleetClient = { id: string; expiresAt: string | null };
export interface Store {
  operatorCount(): Promise<number>;
  fleetClient(): Promise<FleetClient | undefined>;
  allowedEmails(): Promise<number>;
  allowEmail(email: string): Promise<void>;
  close(): Promise<void>;
}

function connect(url: string): SQL {
  return new SQL({ url, max: 2, connectionTimeout: 10, idleTimeout: 10 });
}

export function openStore(
  relay: RelayInstance,
  urls: { relay: string; fleet: string }
): Store {
  const schema = schemaName(relay);
  const relayDb = connect(urls.relay);
  const fleetDb = connect(urls.fleet);
  return {
    async operatorCount() {
      const rows = await relayDb.unsafe(
        `SELECT count(*)::int AS n FROM ${schema}.operators`
      );
      return Number(rows[0]?.n ?? 0);
    },
    async fleetClient() {
      const rows = await relayDb.unsafe(
        `SELECT id, expires_at FROM ${schema}.clients
          WHERE project = $1 AND environment = $2 AND instance = $3 AND revoked = false`,
        [
          FLEET_IDENTITY.project,
          FLEET_IDENTITY.environment,
          FLEET_IDENTITY.instance,
        ]
      );
      const row = rows[0];
      if (!row) return undefined;
      return {
        id: String(row.id),
        expiresAt: row.expires_at
          ? new Date(row.expires_at).toISOString()
          : null,
      };
    },
    async allowedEmails() {
      const rows =
        await fleetDb`SELECT count(*)::int AS n FROM fleet.allowed_emails`;
      return Number(rows[0]?.n ?? 0);
    },
    async allowEmail(email) {
      await fleetDb`INSERT INTO fleet.allowed_emails (email, added_by) VALUES (${email.toLowerCase()}, 'auth-setup') ON CONFLICT (email) DO NOTHING`;
    },
    async close() {
      await Promise.all([relayDb.close(), fleetDb.close()]);
    },
  };
}
