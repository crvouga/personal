# Fleet API

The fleet's control plane, at **https://fleet.chrisvouga.dev**. Every physical machine in [`packages/fleet`](../fleet) reports to it with a heartbeat and receives its dynamic settings from it. The dashboard shows the whole fleet at a glance.

Hono on Bun, raw SQL on Postgres (no ORM), server-rendered Hono JSX styled with Tailwind, shipped as a Docker image on Railway. The wire contract is [PROTOCOL.md](PROTOCOL.md); it is the source of truth for the node agent, the server and the dashboard.

## What it does

| Job                 | How                                                                                                                                                                                                        |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Who is alive        | Nodes `POST /v1/heartbeat` every 60 s. Silence is the alert: `online` (on time), `stale` (a missed beat), `offline` (silent past `alerts.offlineAfterSeconds`, default 300 s).                             |
| What each node is   | Hostname, role, revision, kernel, CPU/RAM, load, disk, addresses, runner slots busy/total, failed units, rollbacks, uptime history.                                                                        |
| Joining             | A node proves it belongs (a per-role token delivered through the GitHub approval) and is approved at once. Any other machine appears under **Pending** until a person approves it.                         |
| Configuration       | Settings per fleet, per role, per node, merged and sent to each node. They change a node's behavior within a minute, with no commit and no rebuild. See [dynamic config](../fleet/docs/dynamic-config.md). |
| Events and alerting | Boots, updates, rollbacks, failed units, disk alerts, approvals, outages and recoveries, with an optional webhook (Slack, Discord, ntfy) for outages. One outage is one notice.                            |
| Metrics             | `GET /metrics` (admin only): `fleet_nodes{status,role}`, `fleet_node_up`, `fleet_node_last_seen_seconds`, `fleet_runner_slots{state}`.                                                                     |

**Data, never code.** The API sends typed settings. It cannot tell a node to run anything, so a compromised API cannot execute code on the fleet. Which repositories may ever register runners is bounded by where the GitHub App is installed.

**The fleet works without it.** A node that cannot reach the API keeps its last settings and the values built into its image; reporting never blocks updates.

## The database is shared

The Postgres is shared with other projects. This service lives only in the schema **`fleet`**:

- Every SQL statement names `fleet.<table>`. Nothing relies on `search_path` (a pooler may ignore it), nothing reads or writes `public` or any other schema, and the server never runs DDL.
- Tests enforce it: decoy tables with the same names in `public` stay byte-for-byte untouched through a full flow, no object appears outside `fleet`, a scan of every SQL string rejects an unqualified table, and no DDL keyword is allowed in `src/`.
- Node secrets are stored only as a SHA-256 hash.

[`schema.hcl`](schema.hcl) is the Atlas definition of everything inside the schema. OpenTofu applies it ([`foundation/fleet-database.tf`](../infra/tofu/foundation/fleet-database.tf)): the PostgreSQL provider creates the empty `fleet` schema and the Atlas provider owns every table, column, index and constraint in it, scoped with `?search_path=fleet`. There is no migration runner. To change the schema, edit `schema.hcl` and apply a reviewed foundation plan.

Do not point an Atlas resource at this database without `search_path`, and do not use `atlas_migration` here. In database-wide mode Atlas diffs every schema against the HCL and plans `DROP SCHEMA public CASCADE`; without a dev database `atlas_migration` cleans the target, and with one it needs Atlas Pro. Both were reproduced against a scratch database. The reasoning is in [tofu/README.md](../infra/tofu/README.md).

## Authentication

| Who                | Credential                                                                           | Where                                           |
| ------------------ | ------------------------------------------------------------------------------------ | ----------------------------------------------- |
| A node, first time | its role token, or nothing (then it waits as pending)                                | `POST /v1/nodes/register`                       |
| A node, afterwards | `Bearer <node id>.<node secret>`; the secret is 32 random bytes, hashed              | `POST /v1/heartbeat`, `/v1/retire`              |
| A person           | Vault username and password; only Vault tokens with the `admin` policy get a session | `/login`, then an HttpOnly, SameSite=Lax cookie |
| Scripts and CI     | `Bearer $FLEET_ADMIN_TOKEN`                                                          | `/v1/*`, `/metrics` (`bun run health` uses it)  |

Browser requests that change state must come from this site (Origin check). Registration and login are rate limited per address. No page, response or log contains a token, a secret hash or a full webhook URL.

## Configuration of the service

| Variable                  | Meaning                                                                                                |
| ------------------------- | ------------------------------------------------------------------------------------------------------ |
| `DATABASE_URL`            | Postgres connection string (`sslmode=require` in production). Never logged.                            |
| `PORT`                    | Default 8080.                                                                                          |
| `FLEET_ADMIN_TOKEN`       | At least 32 characters. Generated by OpenTofu and stored in Vault.                                     |
| `FLEET_SESSION_SECRET`    | At least 32 characters. Signs dashboard sessions.                                                      |
| `FLEET_ROLE_TOKEN_HASHES` | JSON `{ "ci": "<sha256 hex>", ... }`. The service sees hashes only.                                    |
| `VAULT_ADDR`              | Where to check a person's password. Without it, password login is off and the admin token still works. |
| `FLEET_GITHUB_REPO`       | `owner/name` whose `main` defines "latest" for the revision badges. Default `crvouga/workspace`.       |
| `FLEET_DB_PREPARE`        | `true` (default) or `false`. Use `false` behind a transaction-mode pooler.                             |

OpenTofu supplies all of them (inventory entry `fleet-api`, Vault root). Nothing is configured by hand.

## Run it

```sh
bun run --filter @pkgs/fleet-api demo        # the dashboard with 14 synthetic nodes, no database
bun run --filter @pkgs/fleet-api demo -- --empty   # the empty state
bun run --filter @pkgs/fleet-api test        # needs bun, atlas, and Postgres binaries on PATH
bun run --filter @pkgs/fleet-api lint
bun run --filter @pkgs/fleet-api tc
bun run --filter @pkgs/fleet-api build:css   # dist/app.css, built by the Docker image too
docker build -f packages/fleet-api/Dockerfile -t fleet-api .
```

The test suite starts a throwaway Postgres cluster in `$TMPDIR`, creates the schema and applies `schema.hcl` with the real Atlas CLI exactly as production does, and removes everything afterwards. In CI a missing tool fails the run; locally the database tests skip with a message.

## Tested end to end

[`packages/fleet/tests/test_e2e_chain.py`](../fleet/tests/test_e2e_chain.py) runs the whole fleet with the real programs: `fleet-node.sh` (download, checks, the GitHub approval), the approval workflow's `enroll.py`, `fleet-install.sh` (unwrapping the key and installing the node's credentials), the node agent, this server on a throwaway Postgres, and the dashboard over HTTP. Only GitHub, Vault, the release host, the disk listing and `kexec` are stand-ins. CI runs it twice: against the API as a process and against the Docker image (`FLEET_E2E_IMAGE`). It also proved the image runs as the unprivileged `bun` user and passes its own health check.

## Add a setting

1. Add the key to `RULES` in [`src/config/schema.ts`](src/config/schema.ts) (type, range). The dashboard form and the validation are generated from it.
2. Teach the node to apply it: `packages/fleet/scripts/fleetconf.py` (the keys a node understands) and `agent.py`.
3. Document it in [dynamic-config.md](../fleet/docs/dynamic-config.md) and add a test on both sides.

## Layout

```text
schema.hcl            Atlas definition of the `fleet` schema
PROTOCOL.md           the wire contract
src/server.ts         boot, graceful shutdown, background jobs
src/app.ts            the JSON API; routes/ holds node and admin routes
src/db/               the only code that runs SQL (PgStore implements Store)
src/auth/             node credentials, role tokens, sessions, Vault login
src/jobs/             offline notices, webhook, history pruning
src/config/schema.ts  settings: rules, validation, merge, revisions
src/ui/               dashboard pages and components (Hono JSX + Tailwind)
src/testing/          in-memory store, fixtures and demo data
test/                 unit, API, database, isolation and UI tests; test/e2e/stack.ts starts the real stack
```
