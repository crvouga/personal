# Shared authentication relay

**Preproduction: deployed (`auth_relay.live`) but its live and reliability gates are not yet passed.** Any project using the shared managed infrastructure can integrate Google sign-in through standard OIDC without obtaining its own Google credentials, within the supported profile below. Read [operations.md](operations.md) and [acceptance.md](acceptance.md) before deployment.

## Managed local development

`bun run dev` now selects managed resources and loads the existing Vault document
(`AUTH_VAULT_CONFIG`, otherwise `VAULT_CONFIG`, default `dev`). Hostname, realm,
environment and private upstream default to the selected instance in canonical
OpenTofu inventory. Explicit routing overrides remain available for a trusted
private connection. A conflicting environment/scope selection is rejected.
Vault supplies the
console/manager credentials and `AUTH_RELAY_DATABASE_URL`; the launcher maps the
latter to `AUTH_DATABASE_URL` and selects the environment's setup token.

**The managed relay is deployed** at `auth.chrisvouga.dev` (production) and
`auth-dev.chrisvouga.dev` (nonproduction) once the Auth relay deploy workflow has
applied the `live` stage. If infrastructure, Vault projection or Google setup is
missing, local managed startup reports the exact missing Vault fields and fails.
`bun run health -- --only auth` checks those credential prerequisites and probes
both public issuers. It does not present a mock as live authentication.
The private Railway hostname is not reachable directly from a laptop. A trusted
private connection and routing through the configured issuer origin are required;
changing `AUTH_ORIGIN` to a random localhost port cannot reuse an existing
system client's exact callback. See [operations.md](operations.md).

## Explicit local test fixtures

```sh
# Prerequisites: Bun, Docker, OpenTofu 1.13 and the Atlas CLI on PATH.
AUTH_DEV_MODE=local FLEET_DEV_MODE=fixtures bun run dev
# Or run only this service:
bun run --cwd packages/auth-relay dev:fixtures
```

Explicit fixture mode needs no managed AUTH credentials or Vault login. It prepares
an isolated per-worktree PostgreSQL + Keycloak + mock identity provider stack,
then serves the real UI/API (preferred port 8081). The task log prints the URL.
First startup builds images and applies the local schema and system identities
through OpenTofu/Atlas; allow several minutes on a cold runtime. Wait for the
task's explicit `Auth relay READY` message. The UI explicitly labels local test sign-in
as **not Google**. First-operator setup uses `local-development-only`.

All published dependency ports and the local UI bind to loopback. The schema is
`auth_relay_nonproduction`; no managed database, Vault document, Google account
or deployed broker is modified. Local state and its encryption key live under
ignored `.superset/.auth-dev/`. Container volumes retain registrations/operators
across restarts. Stop the task to stop its containers; rerunning reuses the data
and updates the console's exact callback if its application port changes. Run
only one task per local instance; the default instance is scoped to its worktree.
Separate worktrees and explicitly named instances get independent stacks.
An existing default Colima runtime starts automatically when stopped (including
when stopping it removed its Docker context). Other Docker runtimes must be
started first. Explicit Docker endpoints are respected; a healthy daemon is
never restarted. An unhealthy VM reports a bounded failure with recovery steps.

Run `bun run check:dev` from the repository root for repeatable cold/warm
acceptance of all workspace servers. It creates fresh auth state/volumes under a
unique `AUTH_DEV_INSTANCE`, verifies browser sign-in and client registration,
restarts on another callback port, and removes only its own fixture afterwards.
Logs remain in ignored `.superset/.dev-check/`. This check needs a valid local
Vault login for portfolio and remote-cache, plus Playwright Chromium. Ordinary
development keeps its data. `AUTH_DEV_INSTANCE=<name>` optionally selects another
isolated local stack; names must be lowercase letters, digits and hyphens.

To use an already configured provider, set `AUTH_DEV_MODE=configured` and supply
`AUTH_ORIGIN`, `AUTH_UPSTREAM`, `AUTH_REALM`, `AUTH_ENVIRONMENT`,
`AUTH_DATABASE_URL`, `AUTH_CONSOLE_CLIENT_ID`, `AUTH_CONSOLE_CLIENT_SECRET`,
`AUTH_MANAGER_CLIENT_ID`, `AUTH_MANAGER_CLIENT_SECRET`, and `AUTH_SETUP_TOKEN`
in the package's untracked `.env` or process environment. The private provider
must advertise that exact origin/issuer and allow `${AUTH_ORIGIN}/auth/callback`.
An explicitly configured or partially configured provider never falls back to
mock sign-in on failure. Production uses `start`, which remains strict and does
not prepare local fixtures. Local fixture mode refuses production environments.

## Guided Fleet setup

After the deploy workflow is green, `bun run auth:setup` walks the one-time
human steps for Fleet and automates the rest. It reads your own Vault login and
checks live state first, so every step skips when already done and the command is
safe to re-run:

1. Shows (and copies) the two fixed Google redirect URIs to add to the OAuth client.
2. Waits for both relay endpoints to answer.
3. Copies the one-time setup token to your clipboard (never printed), opens the
   relay UI and waits until the operator claim appears in the database.
4. Shows the exact Fleet registration form values, and
   and waits for the registration to appear, then reads back its client ID.
5. Adds your email to Fleet's access list in the Fleet database, after asking.
6. Writes `FLEET_OIDC_ISSUER`, `FLEET_OIDC_CLIENT_ID` and `FLEET_PUBLIC_ORIGIN`
   into the `fleet-api` inventory entry. Merge that change (`/pr-ready`), then re-run
   the command to check the live sign-in page.

The Google console, the operator claim and the registration form stay manual by
design: only an authenticated operator may register a client. Production
registrations expire after at most 366 days, and the command prints the date to
renew before.

## Register in the UI

Open the relay's public origin (`https://auth.chrisvouga.dev` for production, `https://auth-dev.chrisvouga.dev` for nonproduction once deployed). The Bun/Hono service serves the client-side application, management API and public OIDC endpoints from this same domain. Keycloak is the private OIDC engine; its administration API has no public ingress.

1. Select **Continue with Google**. The console authenticates through this relay's own OIDC provider with code + S256 PKCE, state and nonce. Google credentials stay in the provider.
2. An existing operator grants access using your exact relay subject, shown after sign-in. On first installation only, an authorized infrastructure administrator enters the instance's one-time setup token from Vault. **Signing in with Google does not make someone an operator.** The first claim is atomic and cannot be repeated, including after a token rotation.
3. Enter a project, environment, independent instance name, exact callback URLs and expiry. Verify domain/repository/deployment ownership before checking the ownership declaration. Operators are trusted infrastructure administrators with authority across their broker environment, not arbitrary project owners. A hostname or Google email alone is not ownership proof.
4. Save, then copy the displayed issuer, client ID and callback into the application. Registration takes effect without a deployment. The generated client ID is stable across updates; project/environment/instance are immutable. A duplicate identity is rejected rather than taking over an existing client.

**Registrations and allowed URLs live in PostgreSQL, never an application list in source code or infrastructure inventory.** UI operations are runtime application data, explicitly separate from OpenTofu-owned hosting, secrets, roles and Atlas schema definitions. Do not use the Keycloak admin console or old registration workflows to edit consuming clients. Only the console's own two system clients are bootstrapped through OpenTofu, so the UI can authenticate before any application exists.

The database is the existing shared Postgres. Application tables live exclusively in `auth_relay_production` or `auth_relay_nonproduction`, each with a restricted runtime role. They are separate from `public`, `fleet`, other projects and Keycloak's internal schemas. [schema.hcl](schema.hcl) is applied by the foundation root's Atlas provider with an explicit schema-scoped `search_path`. Bun never creates or migrates tables on startup.

## Integrate any framework

Install a maintained OIDC library for your application's framework, then copy the values the UI displays:

```dotenv
OIDC_ISSUER=https://auth-dev.chrisvouga.dev/realms/projects-dev
OIDC_CLIENT_ID=app-<UUID shown in the UI>
OIDC_REDIRECT_URI=http://localhost:5173/callback
OIDC_SCOPES=openid email profile
```

Configure discovery at `${OIDC_ISSUER}/.well-known/openid-configuration`, `response_type=code`, public client authentication (`token_endpoint_auth_method=none`), mandatory S256 PKCE, random state and nonce, and optional `kc_idp_hint=google`. This works for browser apps and SSR libraries supporting public PKCE clients. Confidential consuming clients, refresh/password/implicit grants, native clients and iframe silent renew are outside the initial profile. The browser-only token endpoint supports the registered exact origin through Keycloak's CORS policy; the management API has no cross-origin access.

Bind each transaction to its client, exact callback, browser, state, nonce and verifier. Keep separate transactions per tab, expire after ten minutes, consume once, and never retry an authorization-code exchange after an error or timeout. Validate token signature, issuer, audience, nonce and expiry. Identify people by `(iss, sub)`, not email; do not link accounts by email automatically. Cache JWKS with bounded freshness and refresh once for unknown key IDs. Never bypass authentication during an outage.

Each application creates its own session and owns permissions/user data. SSR cookies should be host-only, HttpOnly, Secure and SameSite=Lax over HTTPS. Use top-level GET redirects, not shared cookies or cross-site iframes. Existing application sessions can continue during a relay outage according to local session policy; no live broker lookup is required on each page. **Localhost cookies are shared across ports:** namespace session and transaction cookies per project AND running instance. Browser-only clients should use per-tab transaction storage and avoid persistent token storage or token-bearing URLs.

## Localhost and changing ports

In the nonproduction UI, choose `localhost`, give every concurrent server its own instance, and register its actual exact URL:

```text
Project A / localhost / server-one: http://localhost:3000/callback
Project B / localhost / server-one: http://localhost:5173/callback
Project A / localhost / server-two: http://127.0.0.1:8080/callback
```

Changing a port requires updating that record in the UI, not Google credentials, source configuration, or the production broker. `localhost` and `127.0.0.1` are different destinations. No port wildcard or native-app loopback exception is used for web clients. Callback removals retain a ten-minute overlap for outstanding flows; explicit revocation and expiry deny new authorization and token exchanges immediately. Nonproduction leases last at most seven days; production leases at most 366 days. Renew explicitly.

A development-server startup helper with scoped credentials is **not yet implemented**. UI registration supports arbitrary exact ports but is not a claim of fully automatic port discovery or unattended project provisioning.

## Production and previews

Use the production console for HTTPS production callbacks, and the nonproduction console for staging, development, CI and previews. These use independent issuers, clients, sessions, schemas and runtime credentials. Register exact unrelated domains freely after an operator verifies their ownership; no shared parent domain is required. Never approve a shared hosting suffix, wildcard, dangling domain or someone else's preview URL.

Register each preview under a unique instance and a short expiry. Revoke in the UI on teardown. The gateway enforces expiry using the database clock even if cleanup is unavailable. A replica-safe maintenance job disables expired/revoked private-provider clients and removes stale transactions. Registrations retain identity tombstones and audit history; they are not reassigned. Automated provisioning with narrowly scoped project-owner credentials is a remaining acceptance gate. There is no unauthenticated public dynamic registration.

Google only sees the relay's fixed upstream callback `/realms/<realm>/broker/google/endpoint`. Google consent branding, verified domains, organization policy, test-user restrictions and platform rules still apply. The relay does not bypass these requirements or impersonate each consuming application's brand.

## Test and troubleshoot

```sh
bun run auth:test
bun run --cwd packages/auth-relay tc
bun run --cwd packages/auth-relay lint
bun run --cwd packages/auth-relay build
bun run auth:test:e2e
bun run health -- --only auth
```

The deterministic suite uses disposable PostgreSQL, Atlas through OpenTofu, two real Keycloak replicas, Chromium and a mock upstream. It never calls Google. Ports 3000, 5173, 8080, 8090, 15432, 18080, 18081, 19080, 3443 and 5443 must be free/reachable from the host. It does not terminate other apps. `AUTH_TEST_PORT_C=18082` permits a partial local run if 8080 is occupied; that does not verify the exact 8080 scenario. Test-only provider imports are never deployed to production.

`unauthorized_client`: confirm active registration, expiry, client ID and exact callback. `invalid_redirect_uri`: compare scheme, host, port and path; callbacks do not support query strings/fragments in this profile. `invalid_grant`: restart login; check the verifier and consumed/expired code. State failure: check stale tabs and localhost cookie namespaces. Operator denied: supply the relay subject to an existing operator, not an email. Registration fails: previous valid configuration stays active; retry the same record after provider recovery. A provider-accepted write followed by a database failure can leave an inaccessible superset internally; the public gateway still permits only committed callbacks. Google `redirect_uri_mismatch`: check the fixed upstream callback on the existing Google web client. Setup denied: check the correct environment's Vault token and whether bootstrap was already claimed.

For the live Google smoke test, register two independent applications on unrelated owned HTTPS domains, sign into both with fresh browser profiles, verify independent local sessions and token issuer/audience, then repeat on concurrent localhost ports and in two tabs. Confirm Google receives only the fixed relay callback. Repeat during a one-replica rolling restart and after stopping the relay with application sessions already established. Record image digest, timestamps, browser versions and outcomes without secrets/codes/tokens. Run Chrome, Safari, Firefox and Edge; Chromium alone does not establish all-browser compatibility.
