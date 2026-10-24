# Fleet API

The fleet's control plane, at **https://fleet.chrisvouga.dev**. Every physical machine in [`packages/fleet`](../fleet) reports to it with a heartbeat and receives its dynamic settings from it. The dashboard shows the whole fleet at a glance.

Hono on Bun, raw SQL on Postgres (no ORM), and a client-rendered React/Mantine administration console, shipped as a Docker image on Railway. The wire contract is [PROTOCOL.md](PROTOCOL.md); it is the source of truth for the node agent, the server and the dashboard.

## Shared admin design

The browser console uses `@pkgs/admin-ui`, the same component library, shell,
spacing, typography, copy controls and Light/Dark/System preference as Relay.
Overview, node search and details, heartbeat charts, pending approvals, events,
scoped settings/history, access management and installer downloads all use it.
Navigation preserves URLs and browser history; live data refreshes every ten
seconds while visible and can be paused. The theme is applied before CSS paints
and follows system changes in System mode.

`GET /ui/state` is a same-origin, noncached view endpoint protected by the
existing Fleet session authorization. It masks webhook paths and query strings
in documents, effective settings and history. Mutations reuse the existing
origin-checked form handlers with JSON responses; neither role credentials nor
new first-sign-in privileges are introduced. Retire, delete and access removal
ask for confirmation. The existing complete HTML forms remain inside `noscript`
for browsers without JavaScript and retain their validation and CSRF behavior.

`bun run build` builds both the fallback CSS and the production console assets.
The early theme script and application bundle are served locally with CSP style
nonces. `bun run demo` builds and serves synthetic data on loopback; it never
connects to the managed database or operates real machines. `dev:fixtures` keeps
its explicit fixture selection, and ordinary `dev` continues using managed data.
The local installer and setup flow use the matching offline design assets from
the shared package. Vendor consoles and portfolio are outside this redesign.

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

| Who                | Credential                                                                             | Where                                           |
| ------------------ | -------------------------------------------------------------------------------------- | ----------------------------------------------- |
| A node, first time | its role token, or nothing (then it waits as pending)                                  | `POST /v1/nodes/register`                       |
| A node, afterwards | `Bearer <node id>.<node secret>`; the secret is 32 random bytes, hashed                | `POST /v1/heartbeat`, `/v1/retire`              |
| A person           | Google through the shared auth relay; verified email must be in `fleet.allowed_emails` | `/login`, then an HttpOnly, SameSite=Lax cookie |
| Scripts and CI     | `Bearer $FLEET_ADMIN_TOKEN`                                                            | `/v1/*`, `/metrics` (`bun run health` uses it)  |

Browser requests that change state must come from this site (Origin check). Registration and login are rate limited per address. No page, response or log contains a token, a secret hash or a full webhook URL.

## Browser authentication and access

Vault is only a secret store. Fleet never sends a person's username/password to
Vault, and has no password login. Google authentication goes exclusively through
the new shared auth relay using OIDC code + S256 PKCE, state and nonce. Fleet
verifies the ID token signature, issuer, audience, expiry and nonce. It stores
only identity and an opaque local session, never Google credentials or tokens.

Configure `FLEET_OIDC_ISSUER` (the relay's HTTPS `/realms/<realm>` issuer),
`FLEET_OIDC_CLIENT_ID` (the public PKCE client registered through the relay UI),
and `FLEET_PUBLIC_ORIGIN` (this Fleet instance's exact origin, without a trailing
slash). Register `${FLEET_PUBLIC_ORIGIN}/auth/callback` as an exact callback.
Use distinct production and nonproduction clients. These are configuration
values, not a Google client secret. If absent, the node API remains usable and
the login page explicitly reports that Google sign-in is unavailable; there is
no password or mock fallback. Partial configuration fails validation.

Production Google sign-in was verified on 2026-10-24 through the deployed relay
and back to Fleet's authenticated dashboard. The public Fleet settings are in
the OpenTofu service inventory; its client registration remains runtime data in
the relay. Renew that registration in the production relay's **Applications**
before 2027-10-23. This sign-in check does not establish the relay's broader
[production acceptance gates](../auth-relay/acceptance.md).

Local `dev` deliberately ignores the deployed browser client settings. Set
`FLEET_LOCAL_OIDC_ISSUER` and `FLEET_LOCAL_OIDC_CLIENT_ID` for a separately
registered nonproduction client. The launcher sets its origin to the actual
`http://localhost:<port>` and uses per-origin cookie names, so concurrent ports
have independent sessions. Browser cookies are shared across localhost ports, so
these names prevent collisions rather than isolating untrusted local services.
Register the exact printed callback and update that
client's callback when the port changes. No wildcard is accepted. Local Google
sign-in requires its own registered nonproduction client; the production Fleet
registration does not authorize localhost callbacks.

Atlas/OpenTofu must apply the new tables before enabling browser sign-in:
`fleet.allowed_emails`, `fleet.access_audit`, `fleet.login_transactions` and
`fleet.browser_sessions`. No runtime DDL, migration, seeding or first-login
approval occurs. For initial access, the database owner inserts their own
verified Google email as runtime data, for example:

```sql
INSERT INTO fleet.allowed_emails (email, added_by)
VALUES (lower('YOUR_GOOGLE_EMAIL'), 'database-owner');
```

After signing in, open **Access** to add or remove allowed email addresses.
Every allowed person is a Fleet administrator. Addresses are trimmed and
lowercased; Google aliases/dots are not merged. Changes are audited. The final
allowed address cannot be removed, including through concurrent removals.
Removal denies existing sessions on their next authorized request. Email-based
access follows ownership of that verified address, so administrators must
review recycled organization addresses.

A signed-in account outside the list sees **Not allowed**, its email, and a
working **Sign out** button. It has no Fleet or access-management permissions.
Sign-out revokes the local session and clears its cookie, including for denied
accounts; the next sign-in requests account selection through the relay. It
does not sign the person out of Google globally. Sessions and ten-minute login
transactions live in PostgreSQL and survive restarts/replicas. Cookies are
HttpOnly, SameSite=Lax, Secure on HTTPS; HTTP is limited to loopback origins.
The removed Vault session cookies are no longer accepted.

## Configuration of the service

| Variable                  | Meaning                                                                                          |
| ------------------------- | ------------------------------------------------------------------------------------------------ |
| `DATABASE_URL`            | Postgres connection string (`sslmode=require` in production). Never logged.                      |
| `PORT`                    | Default 8080.                                                                                    |
| `FLEET_ADMIN_TOKEN`       | At least 32 characters. Generated by OpenTofu and stored in Vault.                               |
| `FLEET_ROLE_TOKEN_HASHES` | JSON `{ "ci": "<sha256 hex>", ... }`. The service sees hashes only.                              |
| `FLEET_GITHUB_REPO`       | `owner/name` whose `main` defines "latest" for the revision badges. Default `crvouga/workspace`. |
| `FLEET_DB_PREPARE`        | `true` (default) or `false`. Use `false` behind a transaction-mode pooler.                       |

OpenTofu supplies core server settings (inventory entry `fleet-api`, Vault root).
Run `bun run auth:setup`; it guides the relay registration and writes these values. Otherwise, after registering the Fleet browser client in the relay UI, declare its public
issuer/client ID/origin as `FLEET_OIDC_ISSUER`, `FLEET_OIDC_CLIENT_ID` and
`FLEET_PUBLIC_ORIGIN` in the service environment through a reviewed OpenTofu
plan. Do not mutate hosting dashboards. No Google secret is copied into Fleet.

## Run it

Workspace `bun run dev` starts the real database-backed API and dashboard, using
`vault run --config prd` to read the existing managed fleet credentials. No demo
data is seeded or substituted. Sign in with Google through the auth relay using an allowed email address. The port starts at 8082, or `FLEET_API_PORT`, and advances when
occupied; the local server binds only to `127.0.0.1`.

**Local and deployed dashboards show the same managed fleet data.** Authenticated
edits in either affect real nodes. The local dashboard labels this explicitly.
Local startup disables offline notifications, webhooks and history pruning;
these jobs remain owned by the deployed server. Production `src/server.ts` keeps
its existing background jobs, authentication and network binding.

`FLEET_VAULT_CONFIG=dev` selects another existing Vault document explicitly; it
must contain all required fleet credentials and the intended database URL.
The current fleet credentials exist only in `prd`, so that is the fleet-specific
default, independently of the root `VAULT_CONFIG=dev` used by portfolio/cache.
Missing credentials or an unavailable database never trigger synthetic fallback.
No schema changes or infrastructure apply run during startup.

```sh
bun run --filter @pkgs/fleet-api dev
# Read-only verification against a running local server's actual printed port:
vault run --config prd -- bun scripts/check-dev-fleet.ts 8082
# Explicit synthetic mode for UI work and deterministic acceptance:
bun run --filter @pkgs/fleet-api dev:fixtures
```

```sh
bun run --filter @pkgs/fleet-api demo        # the dashboard with 14 synthetic nodes, no database
bun run --filter @pkgs/fleet-api demo -- --empty   # the empty state
bun run --filter @pkgs/fleet-api test        # needs bun, atlas, Postgres and Playwright Chromium
bun run --filter @pkgs/fleet-api lint
bun run --filter @pkgs/fleet-api tc
bun run --filter @pkgs/fleet-api build:css   # dist/app.css, built by the Docker image too
docker build -f packages/fleet-api/Dockerfile -t fleet-api .
```

The test suite starts a throwaway Postgres cluster in `$TMPDIR`, creates the schema and applies `schema.hcl` with the real Atlas CLI exactly as production does, and removes everything afterwards. In CI a missing tool fails the run; locally the database tests skip with a message.

## Installer recommendation

The add-node page and empty overview recommend a direct installer download using browser platform and architecture hints. Windows x64, macOS Intel/Apple silicon, and Linux x64/ARM64 map to their release files. NixOS opens its native launcher instructions. Nothing downloads automatically.

Some browsers hide the Mac CPU or Linux distribution. An ambiguous Mac never defaults to Intel; choose Apple silicon or Intel in **Installer for**. On NixOS whose browser reports generic Linux, choose **NixOS — native installer**. The selector also supports preparing another computer, keeps that choice through live dashboard refreshes, and takes precedence over delayed detection. **All installers** works without JavaScript. Mobile, ChromeOS, 32-bit Windows and Windows ARM64 do not receive an unsupported native recommendation.

The normal test command includes Playwright BDD Gherkin browser acceptance. To run it separately:

```sh
cd packages/fleet-api
bunx playwright install --with-deps chromium
bun run test:bdd
# All browser profiles against the deployed page, plus an actual Windows
# executable download verified against GitHub's published size and SHA-256:
FLEET_DOWNLOAD_LIVE=1 vault run --config prd -- bun run test:bdd
```

Local acceptance uses the real dashboard routes/assets with an in-memory store. Production acceptance uses owner authorization, keeps traces off, and never records credentials. Reports are generated under `dist/download-bdd-report/` and `dist/download-bdd-results.json`.

## Tested end to end

[`packages/fleet/tests/test_e2e_chain.py`](../fleet/tests/test_e2e_chain.py) runs the whole fleet with the real programs: `fleet-node.sh` (download, checks, the GitHub approval), the approval workflow's `enroll.py`, `fleet-install.sh` (unwrapping the key and installing the node's credentials), the node agent, this server on a throwaway Postgres, and the dashboard over HTTP. Only GitHub, Vault, the release host, the disk listing and `kexec` are stand-ins. CI runs it twice: against the API as a process and against the Docker image (`FLEET_E2E_IMAGE`). It also proved the image runs as the unprivileged `bun` user and passes its own health check.

## Add a setting

1. Add the key to `RULES` in [`src/config/fields.ts`](src/config/fields.ts) (type, range). The dashboard form and the validation are generated from it.
2. Teach the node to apply it: `packages/fleet/scripts/fleetconf.py` (the keys a node understands) and `agent.py`.
3. Document it in [dynamic-config.md](../fleet/docs/dynamic-config.md) and add a test on both sides.

## Layout

```text
schema.hcl            Atlas definition of the `fleet` schema
PROTOCOL.md           the wire contract
src/server.ts         boot, graceful shutdown, background jobs
src/app.ts            the JSON API; routes/ holds node and admin routes
src/db/               the only code that runs SQL (PgStore implements Store)
src/auth/             node credentials, role tokens, Google/relay OIDC and sessions
src/jobs/             offline notices, webhook, history pruning
src/config/fields.ts  browser-safe settings metadata and rules
src/config/schema.ts  settings validation, merge, revisions
src/console/          React/Mantine administration views
src/ui/               server authorization, data adapters and no-JavaScript fallback
src/testing/          in-memory store, fixtures and demo data
test/                 unit, API, database, isolation and UI tests; test/e2e/stack.ts starts the real stack
```

## Google authentication validation

The package test command runs a Chromium journey through an isolated HTTPS mock
relay with real signed ID tokens and PostgreSQL-backed authorization. It proves
that denied people can sign out and use an allowed account, and that allowed
administrators manage the access list. Additional tests cover JWT tampering,
issuer/audience/nonce/expiry, callback replay, transaction expiry, concurrent
tabs, restart persistence, copied sessions across origins/clients/issuers,
immediate access removal and concurrent last-account protection. No Google
request or live access-list mutation is made by these tests.

Before live activation, apply the reviewed schema plan, deploy the relay with
verified Google email claims, register separate Fleet clients and exact callbacks,
and configure each Fleet origin. Insert the initial email yourself. With a fresh
browser, verify an unlisted Google account reaches **Not allowed**, can sign out,
and can select a listed account. Verify **Access** can add/remove a second test
email and removal denies its established session. Repeat on the actual local
callback port and deployed HTTPS origin, including after a restart. Record the
results before claiming live Google compatibility. This rollout remains blocked
by the relay deployment prerequisites documented in its operations guide.

## SQL runtime reliability

CI, development tools and service images pin official Bun 1.4.4. Fleet refuses
Bun versions before 1.4 when constructing its database pool, with
`FLEET_DATABASE_RUNTIME_UNSUPPORTED`, rather than allowing indefinite pool waits.
Earlier 1.3.x releases have upstream transaction/prepared-query scheduling defects
tracked in [Bun #32004](https://github.com/oven-sh/bun/issues/32004) and
[Bun #33985](https://github.com/oven-sh/bun/issues/33985); fixes landed before
1.4 stable. The pool contention regression runs transactions and ordinary
parameterized queries with more workers than connections and awaits every result.
Test timeout limits remain unchanged. Dependencies are not patched.
