# Fleet API protocol (v1)

The contract between `packages/fleet-api` (the server), `packages/fleet/scripts/agent.py` (the node agent) and the dashboard. TypeScript types are in `src/types.ts`; configuration keys are in `src/config/schema.ts`. If this file and the code disagree, fix the code or this file in the same commit.

Base URL: `https://fleet.chrisvouga.dev`. All bodies are JSON (`Content-Type: application/json`). Times are ISO 8601 UTC. Errors are `{ "error": "<code>", "message": "<what happened and what to do>" }`.

## Principles

- **Data, never code.** The server can tell a node _what its settings are_. It cannot tell a node to run anything. A compromised server must not be able to execute code on the fleet. Nodes only interpret the typed keys in `FleetConfig`.
- **The fleet works without the API.** A node that cannot reach the server keeps its last configuration (cached on disk) and its built-in defaults. Reporting is best effort and never blocks updates (`fleet-sync`).
- **The database is shared with other projects.** Everything lives in the Postgres schema `fleet`, created by OpenTofu and shaped by Atlas (`schema.hcl`). Every SQL statement names `fleet.<table>`; nothing reads or writes `public` or any other schema, and the server never runs DDL.

## Identity and credentials

| Credential     | Held by                                                                                        | Used for                                                |
| -------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| node id        | derived from hardware (never secret)                                                           | names the node                                          |
| node secret    | the node (`/nix/fleet-state/agent/node.secret`, 0600)                                          | `Authorization: Bearer <id>.<secret>` after registering |
| role token     | nodes enrolled through the GitHub approval, kept in `/nix/fleet-state/agent/role-token` (0600) | register without waiting for a person                   |
| admin token    | scripts and CI (`FLEET_ADMIN_TOKEN`)                                                           | `Authorization: Bearer <token>` on admin routes         |
| session cookie | a person signed in to the dashboard                                                            | the dashboard and admin routes                          |

- **Node id** is the lowercase sha256 hex (64 chars) of the machine's stable hardware material, exactly the digest whose first four hex digits are the node's hostname suffix (`ci-a3f9` -> id starts `a3f9`). It is `/run/fleet/node` field `machine_id`.
- The server stores `sha256(node secret)` only. A node secret is 32 random bytes, hex encoded (64 chars).
- `FLEET_ROLE_TOKEN_HASHES` is a JSON object `{ "ci": "<sha256 hex>", ... }`. The server compares `sha256(presented role token)` to the hash for the node's claimed role with a constant-time comparison.
- Browser authentication is Google through the shared auth relay only: OIDC code + S256 PKCE, state, nonce and signature/issuer/audience/expiry verification. The verified email must appear in `fleet.allowed_emails`. Fleet uses an opaque, database-backed session, rechecks access on authorized requests and invalidates it on sign-out. Vault only stores application secrets.
- `/not-allowed` shows a denied signed-in account and permits same-origin sign-out without requiring allowlist access. `/access` manages allowed emails for existing allowed administrators, auditing changes and protecting the final allowed address. Initial access is populated by the database owner. See README for schema rollout and exact callback configuration.

## Node endpoints

### `POST /v1/enrollment/check` (role credential)

Read-only, rate limited like registration. Send `{ "role": "ci", "roleToken": "..." }`
over HTTPS. `200 { "ok": true, "role": "ci" }` proves the credential matches
Fleet's automatic-approval configuration. Invalid credentials return `401`;
malformed input returns `400`. No node, secret or event is created. The live
installer additionally registers the actual hardware and requires `approved`
before erasing; an explicitly rejected identity cannot silently proceed.

The optional heartbeat `readiness` object contains up to 12 public diagnostic
issues, each at most 500 characters. Missing means unknown, not ready. An empty
list means the installed agent verified the update timer and current revision's
cache/sync check, recovery credential, and (for CI) GitHub runner availability.
The console combines it with current membership/connectivity and failed units;
an online heartbeat alone does not establish readiness. Bootstrap reports use
the same protocol and private node credential, copied into the installed system,
with a nonempty installation issue until the installed agent takes over.

### `POST /v1/nodes/register` (no credential)

Rate limited per address. Idempotent: calling it again for the same id replaces the stored secret hash (a reinstall has a new secret).

```json
{
  "nodeId": "<64 hex>",
  "role": "ci",
  "hostname": "ci-a3f9",
  "secret": "<64 hex, new random>",
  "roleToken": "<optional>"
}
```

`201`/`200`:

```json
{ "status": "approved", "heartbeatIntervalSeconds": 60 }
```

- A valid `roleToken` for `role` -> `approved` immediately, `enrolledVia: "role-token"`.
- Otherwise `status: "pending"`, `enrolledVia: "hello"`; a person approves in the dashboard. The node keeps reporting while pending; the server stores its facts so the person can see what they are approving.
- A node that a person rejected stays `rejected`; a retired node that registers again becomes pending (or approved with a valid role token).
- `400 invalid_request`, `429 rate_limited`.

### `POST /v1/heartbeat` (`Authorization: Bearer <id>.<secret>`)

Body: `HeartbeatBody` (`src/types.ts`). Send every `heartbeat.intervalSeconds` (default 60) and once at boot. Example:

```json
{
  "v": 1,
  "nodeId": "<64 hex>",
  "role": "ci",
  "hostname": "ci-a3f9",
  "capabilities": ["gpu"],
  "revision": "9f3c2a1e...",
  "bootId": "5b0f...",
  "uptimeSeconds": 86400,
  "kernel": "6.12.30",
  "arch": "x86_64",
  "cpu": { "cores": 16, "model": "AMD Ryzen 9 9955HX" },
  "memory": { "totalMiB": 63000, "availableMiB": 41000 },
  "load1": 0.42,
  "disk": { "nixUsedPercent": 37, "bootUsedPercent": 12 },
  "addresses": ["192.168.1.20"],
  "sync": { "rolledBack": false, "healthFailure": null, "paused": false },
  "failedUnits": [],
  "readiness": { "issues": [] },
  "runners": { "slots": 4, "busy": 1 },
  "agent": { "version": "1", "configRevision": "0123456789abcdef" },
  "events": [{ "kind": "boot", "severity": "info", "message": "node started" }]
}
```

Response `200`:

```json
{
  "ok": true,
  "status": "approved",
  "serverTime": "2026-10-14T12:00:00.000Z",
  "config": {
    "revision": "<16 hex>",
    "values": { "sync": { "paused": false } }
  }
}
```

- `config` is present only when the node's `agent.configRevision` differs from the server's current revision. The agent persists it, applies it, and reports the new revision next time. `values` is `nodePayload(resolveConfig(...))`: it never contains `alerts`.
- A `pending` node gets `status: "pending"` and `config` with only `heartbeat.intervalSeconds`.
- `401 unauthorized` for an unknown id or wrong secret (the agent re-registers). `403 rejected`/`retired` for those states (the agent backs off to hourly).
- The body's `nodeId` must equal the credential's id. `events` is at most 20 entries, `message` at most 500 chars. Anything else over limits is `400`.
- The server derives `hostname`, `role`, `revision` from the body. It never trusts the body for approval or labels.

### `POST /v1/retire` (`Authorization: Bearer <id>.<secret>`)

Sent by `fleet-node remove`. Marks the node `retired`, records an event, and stops "offline" notices for it. `200 { "ok": true }`.

## Admin endpoints (Bearer admin token or session cookie)

State-changing browser requests also require a same-origin `Origin` header (CSRF).

| Method and path                                 | Purpose                                                                                                                                    |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `GET /v1/nodes`                                 | All nodes as `NodeView` (status, label, age), newest report first                                                                          |
| `GET /v1/nodes/:id`                             | One node, plus `heartbeats` (last 24 h) and its resolved `config`                                                                          |
| `PATCH /v1/nodes/:id`                           | `{ displayName?, note?, labels? }`                                                                                                         |
| `POST /v1/nodes/:id/approve`                    | pending -> approved                                                                                                                        |
| `POST /v1/nodes/:id/reject`                     | -> rejected                                                                                                                                |
| `POST /v1/nodes/:id/retire`                     | -> retired                                                                                                                                 |
| `DELETE /v1/nodes/:id`                          | forget the node and its history (events keep its label)                                                                                    |
| `GET /v1/summary`                               | `FleetSummary`                                                                                                                             |
| `GET /v1/events?node=&severity=&before=&limit=` | events, newest first                                                                                                                       |
| `GET /v1/settings`                              | every stored scope                                                                                                                         |
| `GET /v1/settings/:scope`                       | `fleet`, `role:ci`, `node:<id>`; plus `effective` for node scopes                                                                          |
| `PUT /v1/settings/:scope`                       | replace a scope's document (validated; unknown keys rejected); appends history                                                             |
| `GET /v1/settings/:scope/history`               | who changed what                                                                                                                           |
| `GET /metrics`                                  | Prometheus text: `fleet_nodes{status,role}`, `fleet_node_up{node,role}`, `fleet_node_last_seen_seconds{node}`, `fleet_runner_slots{state}` |

## Public endpoints

- `GET /health` - `200 { "ok": true }` when the process is up and the database answers `select 1`; `503` otherwise. Used by Railway and `bun run health`.
- `GET /assets/app.css` - the compiled stylesheet.

## Dashboard (cookie session)

`GET /login` (Google sign-in), `GET /auth/login`, `GET /auth/callback`, `GET /not-allowed`, `POST /logout`, `GET /access` and `POST /access` (allowed administrators only); `POST /login` returns 410 and never creates a session; `GET /` fleet overview; `GET /nodes`, `GET /nodes/:id`; `GET /pending`; `GET /events`; `GET /settings`, `GET /settings/:scope`, `POST /settings/:scope`; `GET /ui/fleet` (an HTML fragment of the overview for auto refresh).

## Background work (inside the server process)

- Every 30 s: nodes `approved`, silent longer than `alerts.offlineAfterSeconds` (default 300) and not yet announced get an `offline` event (severity `error`), `offline_notified_at`, and a webhook POST if `alerts.webhookUrl` is set. A node that reports again gets a `recovered` event and the notice is cleared. One outage is one notice.
- Every hour: heartbeat history older than 7 days is deleted. Events and settings history are kept.

## Limits

Request bodies are capped at 64 KiB. `register` and `login` are limited per remote address. Dashboard pages never show the node secret hash or any token.

## Server behavior (as implemented)

Details the sections above leave open. `test/api/**` and `test/db/**` pin every line.

### Environment

`DATABASE_URL` (`sslmode=require` is honored and never falls back to plaintext; `require` does not verify the certificate, like libpq), `FLEET_ADMIN_TOKEN` (at least 32 characters), `FLEET_ROLE_TOKEN_HASHES` (JSON object, `{}` for none), `FLEET_GITHUB_REPO` (default `crvouga/workspace`), `PORT` (default 8080), `FLEET_DB_PREPARE=false` (no named prepared statements, for a transaction-mode pooler). Browser login additionally uses `FLEET_OIDC_ISSUER`, `FLEET_OIDC_CLIENT_ID` and `FLEET_PUBLIC_ORIGIN` as a complete set. The issuer must be an HTTPS relay realm, and the callback must be registered exactly. `FLEET_SESSION_SECRET` and `VAULT_ADDR` no longer participate in browser authentication. A bad environment stops the process at boot, naming variables and never values.

### Registration and approval

- Registering again replaces the secret. A node that was `approved` and registers without a valid role token goes back to `pending` (a reinstall must be approved again, and nobody who learns a node id can take over an approved node silently). With a valid token it stays `approved`. `rejected` always stays `rejected`; `retired` becomes `pending` or, with the token, `approved`.
- A `roleToken` that does not match is not an error: the node is simply `pending`.
- `403 rejected` / `403 retired` on heartbeat and retire are answered only to a caller that holds the node's secret; anyone else gets `401`. A retired node may call `POST /v1/retire` again (`200`).
- `register` is limited to 20 per minute per address, `POST /login` to 10 per five minutes. The address is `cf-connecting-ip`, else the first `x-forwarded-for` entry, else the socket. Refusals are `429 { error: "rate_limited", retryAfterSeconds }` with `Retry-After`.

### Heartbeat

- Unknown keys in the body are ignored and never stored (a newer agent does not break an older server). Types, ranges and sizes are checked; every problem is returned in `errors`.
- `role`, `hostname` and `revision` are taken from the body. The stored `facts` are the body without `events`.
- The server writes derived events, once per change and only for `approved` nodes: `boot` (new `bootId`, unless the agent sent its own `boot`), `revision`, `rollback` / `rollback_cleared`, `units_failed` / `units_recovered` (only the units that changed), `disk_high` / `disk_ok` (per mount, at `disk.alertPercent`, default 90), and `recovered` (first report after an `offline` notice).
- Registration and admin actions write `registered`, `reregistered`, `approved`, `rejected`, `retired`, `pending`, `node_updated`, `node_deleted`.

### Admin API

- Bodies: `PATCH` takes `displayName` (80 chars), `note` (1000), `labels` (16 distinct, `[A-Za-z0-9_.:-]{1,50}`); `null` or blank clears text. `PUT /v1/settings/:scope` takes the document itself; errors are `400 { error: "invalid_settings", errors: [...] }`.
- Responses: `{ nodes }`, `{ node, heartbeats, config }` (`config` is the full merge, `alerts` included), `{ node }` for patch/approve/reject/retire, `{ ok: true }` for delete, `{ events, nextBefore }`, `{ settings }`, `{ scope, value, updatedAt, updatedBy, effective? }`, `{ history }`.
- `events?severity=warn` means warn and error; `severity=error` only error. `before` is an event id; `limit` is 1-200 (default 50). `nextBefore` is null on the last page.
- `DELETE` removes the node, its heartbeat history and its `node:<id>` settings document; events and settings history stay. Approve, reject and retire on the state a node already has change nothing and write no event.
- A cookie-authenticated state-changing request needs an `Origin` (else `Referer`) that names this host (or `x-forwarded-host`); only a request that itself carries the admin Bearer token skips that check.
- Every `/v1/*` answer is `Cache-Control: no-store`; unknown `/v1` paths are `404 { error: "not_found" }`.

### Metrics

`fleet_node_last_seen_seconds` is the number of seconds since the node last reported. `fleet_node_up` and `fleet_node_last_seen_seconds` exist only for `approved` nodes; `fleet_nodes` has a series for every status and role.

### Background work

No offline notice is sent in the first two minutes after the process starts, so an API outage does not announce the whole fleet when it ends. A notice is recorded before the webhook is tried; webhook failures (timeout 5 s, no redirects, https only) are logged and never repeated.
