# Auth relay operations

The objective is 99.9% availability of new sign-ins per calendar month, including upstream failures (43.2 minutes per 30 days). This is a target, not an achieved SLA. Local application sessions remain independent and never silently fail open.

## Ownership and isolation

OpenTofu exclusively manages infrastructure. `foundation/auth-relay.tf` defines restricted roles and isolated schemas in the existing shared PlanetScale PostgreSQL database. Atlas owns console tables through `schema.hcl`, with `search_path=auth_relay_production` or `auth_relay_nonproduction`; never remove that scoping or point Atlas at the whole database. Runtime roles receive USAGE on their schema and DML/sequence privileges on their tables, not CREATE or access grants to other application schemas. Keycloak internal tables use separate `auth_production` / `auth_nonproduction` schemas. No dedicated database or persistent container volume is introduced.

The UI owns consuming application records, exact callbacks, expiries and operators as runtime data. This is the explicit auth-relay exception to the former infrastructure-managed registration approach, not permission for an application to provision cloud resources. `auth` bootstraps only realms, Google upstreams, signing keys, the console login client and its private registration service account. Never manage the same consuming client from OpenTofu and the UI. The old GitHub registration/expiry workflow and inventory project allowlists have been removed.

`auth-hosting` declares two public Bun/Hono replicas per instance, one single-replica `cloudflared` admin connector, and lets every service sleep when idle (side-project cost; the first request after idle pays a cold start, and open database or tunnel connections can keep a service awake) and one private Keycloak replica with a local cache (Railway replicas cannot form a JGroups cluster, and the shared PostgreSQL cluster has few connection slots; the compatibility suite still builds the clustered `KC_CACHE=ispn` variant to exercise two replicas). Only Hono owns the public hostname. Keycloak gets no public domain or DNS; its admin API and management metrics stay private. Keep untrusted workloads out of the broker's private Railway project/environment: private networking is a trust boundary. Hono proxies the configured realm/resources, not `/admin` or dynamic registration. The realm-scoped manager can manage clients but cannot manage users or realms; its secret never reaches the browser. Production and nonproduction should ultimately use separate private network environments for stronger isolation; separate services/schemas alone do not provide a network boundary inside the existing shared Railway environment.

## Local development

Explicit `dev:fixtures` (or `AUTH_DEV_MODE=local`) prepares owned loopback-only Docker runtime dependencies and applies
the `auth-development` OpenTofu root, never the foundation/Vault/production roots.
Local state/plans are encrypted under ignored `.superset/.auth-dev/`; keep that
state/key together with the owned Docker volume when preserving local data.
Atlas is scoped to the local `auth_relay_nonproduction` schema, with a separate
local scratch database. Plans are checked for owned addresses and no deletions
before apply. Local system clients track the selected exact callback port.
A per-instance lock prevents two commands from reconfiguring the same local
broker simultaneously. Use separate worktrees or `AUTH_DEV_INSTANCE` names for
separate broker instances. The database's published port remains stable because
Atlas retains its URL in state. Before schema work, the launcher compares the
host connection's PostgreSQL cluster identity with the owning container, refusing
to write through a conflicting forwarder. Other dependency ports may be replaced
when occupied; application callback ports may change normally.
The mock key persists in its own volume so restarts do not change its signing key.
Startup logs each preparation phase. The Docker availability check fails after
15 seconds rather than waiting indefinitely. An existing default Colima runtime
starts automatically when stopped; startup allows three minutes for that boot,
ten minutes for cold image builds and four minutes per schema command. Explicit
Docker endpoints are never replaced. If an existing VM is unhealthy, verify the
daemon is responsive. For Colima, restart it with `colima stop --force` then
`colima start`, and restart the Run task. Do not delete its disks or volumes to
recover an unresponsive daemon: they hold the persisted local database.
Termination cancels outstanding startup commands before stopping owned
containers, and releases the instance lock even when container cleanup fails.
Local Keycloak overrides the image's production shutdown delay to zero, and
the Bun watch supervisor receives SIGINT, so headless task-runner shutdown can
finish within its grace period. Production draining settings are unchanged.
`bun run check:dev` provisions disposable local state through this same launcher
and verifies the cold/warm lifecycle without resetting ordinary development data.

Default `dev` loads managed credentials from Vault and resolves deployment metadata
from the canonical inventory, selecting its instance by Vault scope. It rejects
a conflicting `AUTH_ENVIRONMENT`, names missing fields using their Vault keys,
and refuses missing credentials;
it does not provision the staged live relay or silently choose fixtures. A local
managed instance requires trusted private upstream reachability and routing through
its exact registered issuer origin. The UI and task log explicitly identify
fixture sign-in. Fixture mode never reads
Vault or contacts Google and rejects production environments. Managed mode is the default; provider failures do not trigger a mock fallback.
Production `start` continues to require all settings. See README for prerequisites.
The local root uses a read-only ID lookup because the pinned Keycloak client data
source attempts a forbidden secret read on the built-in bearer-only management
client; production bootstrap compatibility still requires validation before launch.

## Deployment and schema lifecycle

Rollout is staged by two inventory flags. `enabled` creates the foundation resources, the private Keycloak identity service, its tunnel connector and the realm; `live` additionally projects the realm's system credentials into Vault and deploys the public Bun/Hono gateway (`live` requires `enabled`). The [Deploy workflow](../../.github/workflows/deploy.yml), using its [auth action](../../.github/actions/deploy-auth/action.yml), orders every root (foundation, auth-hosting, auth per instance, vault, auth-hosting) and builds the three public images (`chrisvouga-auth-relay`, `-identity` from `Dockerfile.keycloak`, `-tunnel` from `Dockerfile.tunnel`); it pins their digests and refuses to continue if GHCR does not serve them anonymously. The workflow's first `auth-hosting` pass deploys only the private services while an instance has no gateway (`deploy_gateway=false`), because the gateway reads credentials that the `vault` root projects after the realms exist; the last pass deploys the gateway behind a fresh Vault login (the CI token lives 15 minutes), then the workflow waits for each public `/health/ready` before the health check, since Railway verifies the custom domain and issues its certificate after the apply returns. The CI Vault role needs `auth/token/lookup-self` and `auth-hosting` sets `skip_child_token`, as the role has no default policy and cannot create tokens. Keep `auth_relay.enabled=false` until you intend to deploy. It is a rollout gate, not a reversible teardown flag; database resources have prevent_destroy. Use immutable image digests, reviewed saved plans, encrypted state and serial Railway operations (`-parallelism=1`). Public image: repository-root build context, `packages/auth-relay/Dockerfile`. Private image: `packages/auth-relay/Dockerfile.keycloak`, package build context. Build the UI with Bun; the production image serves compiled JS with its Hono API from the same origin.

Deployment requires access to the existing encrypted remote state: its state
passphrase, backend access credentials/configuration, provider credentials and
current Vault input document. These are bootstrap trust anchors supplied through
the established deployment environment, not generated by local startup or read
from GitHub secret values. Without them a local command cannot initialize the
correct state, review a saved plan or apply safely. Do not use a new empty state
or fresh encryption key to bypass missing access. No remote backend/inputs or
bootstrap state credentials were available in the local environment during the
2026-10-16 investigation; no deployment apply was attempted.

**Admin access.** Keycloak's admin API has no public ingress. Foundation creates a Cloudflare Tunnel per instance (`auth-admin-<instance>`), a proxied CNAME at the inventory `admin_hostname` and an Access application whose only policy admits a dedicated service token. A `cloudflared` connector service runs inside the private Railway project and forwards that hostname to the identity service's internal address. The `auth` root signs in as the generated master-realm bootstrap admin (`KC_BOOTSTRAP_ADMIN_*`, from the encrypted foundation state output `auth_admin`) with the Access headers; the Hono gateway still proxies only realm/resources. The service token, tunnel token and admin password never leave encrypted state, CI masks and the identity service's variables. Rotate them by replacing the corresponding foundation resources.

**Keycloak schema initialisation.** Identity services run with `MIGRATION_STRATEGY=validate` and `INITIALIZE_EMPTY=false`. The deploy workflow sets `keycloak_schema_init=true` for the one apply that happens while an instance has no realm state, so Keycloak creates its tables in the empty `auth_*` schema, then re-applies with the default (validate). A Keycloak version upgrade is a separate, reviewed maintenance step: set the variable deliberately after taking a backup.

First adoption requires a staged plan: foundation roles/empty schemas, then schema-scoped Atlas tables/grants; private identity service and reviewed Keycloak initial migration; `auth` realm bootstrap using a private trusted administration connection; Vault projection of system credentials; full hosting plan. Use a reviewed targeted plan for the private identity service only during bootstrap, never an unchecked normal deployment shortcut. `auth-production.tfstate` and `auth-nonproduction.tfstate` are independent encrypted realm states. Vault reads them only when enabled. Do not enable the public gateway before its dependencies exist.

**Keycloak's initial table/changelog migration and safe version-upgrade strategy remain unresolved production gates.** The production image deliberately validates its schema and must not initialize/update it on startup. Do not work around this using shell provisioners or manual DDL. The disposable test fixture permits upstream initialization; it is not a deployment procedure. Foundation's empty-schema bootstrap permits only creation of the relay schemas and restricted roles before Atlas inspection; existing managed schemas remain in the full plan. Import any already-existing schema/role before adoption; never replace live resources.

Bun readiness `/health/ready` checks its schema and private-provider discovery; liveness `/health/live` is process-only. Bounded DB pools, request sizes, upstream timeouts and database-backed per-client/global admission limits contain overload. These are initial limits, not proof of fair capacity under hostile traffic. SIGTERM stops accepting requests and drains them before database shutdown, with a 25-second deadline. Railway overlap/drain settings are 60 seconds with automatic failure restart. Verify actual routing and termination in deployment; declarations alone are not evidence.

The shared PostgreSQL cluster has about 25 connection slots. Each gateway is
limited to one connection and each private Keycloak to two: the four gateways
and two identity services together can hold eight connections at steady state,
leaving room for Vault, other applications and schema/deployment operations.
The clustered compatibility fixture uses four connections per Keycloak because
JDBC_PING requires that minimum; it does not use the production local cache.
Rolling overlap temporarily adds pools; keep deploys serial and monitor actual
usage. PostgreSQL `53300` (remaining slots reserved for superusers) means database
capacity is exhausted, not that a Google email lacks permission. Do not seed an
operator or retry a consumed authorization code to recover from it.

The identity image sets
`KC_SPI_USER_SESSIONS__INFINISPAN__SESSION_EXPIRATION_PERIOD=900` (15 minutes).
Keycloak 26.8.1 defaults to 180 seconds and scans 64 session buckets per realm,
even when no sessions have expired. The longer interval reduces scheduled
cleanup scans by 80% for this small shared database. It delays deletion of
expired rows and the associated cleanup events; it does not extend session
idle/max lifetimes, which Keycloak validates when sessions are used. See the
[pinned cleanup implementation](https://github.com/keycloak/keycloak/blob/26.8.1/model/infinispan/src/main/java/org/keycloak/models/sessions/infinispan/InfinispanUserSessionProviderFactory.java)
and [request-time validation](https://github.com/keycloak/keycloak/blob/26.8.1/services/src/main/java/org/keycloak/services/managers/AuthenticationManager.java).
After deploying the rebuilt identity image, compare query counts over a full
day and monitor expired-row backlog and cleanup duration. Higher session churn
may warrant a shorter interval.

## Account selection

Every new browser authorization must reach Google's account chooser. The gateway
sets `prompt=login` and `kc_idp_hint=google` on the authorization endpoint and removes
`login_hint` / `id_token_hint`, preventing broker SSO from choosing the previous
identity. The OpenTofu-owned Google provider separately fixes its upstream prompt
to `select_account`, which Google supports ([Google's OIDC parameters](https://developers.google.com/identity/openid-connect/openid-connect#authenticationuriparameters)).
Ship the provider setting through the reviewed auth-root plan before deploying
the gateway change; Google does not document support for `prompt=login`.
This applies to console and consuming applications; established application
sessions retain their own lifecycle. Verify repeated sign-in with one and multiple
Google accounts in the same browser during live acceptance.

## Verified email claims

Consumers can require verified Google emails. The Google provider enables
`trust_email` so Keycloak preserves Google's `email_verified` assertion rather
than requiring a second broker email-verification flow. It still uses the
standard first-broker-login confirmation flow, with no automatic email account
linking. A verified email grants neither relay operator access nor application access;
those permissions remain separate database-owned decisions. Existing unverified
broker users need review before live rollout. The pinned provider's behavior is
specified in [Keycloak's OIDC implementation](https://github.com/keycloak/keycloak/blob/26.8.1/services/src/main/java/org/keycloak/broker/oidc/OIDCIdentityProvider.java#L1071).

## Credentials and bootstrap

Use `bun run vault:edit --google` from the repository root to replace the Google
client ID and secret. It selects production, nonproduction or both, shows the
exact broker callbacks, preserves other inputs, and walks saved OpenTofu plans
for the persistent deployment inputs, Vault and the selected Google providers.
`--dry-run` previews without applying; `--demo` uses synthetic data without
connecting to infrastructure. See the root [secret editor guide](../../README.md#update-secrets)
for state-access prerequisites and partial-update recovery.

Supply `GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET` through the vault root's `secrets` input for `dev` and `prd` (`bun run vault:secrets`). CI reads that input from the `TOFU_VAULT_INPUTS` Actions secret (owned by the foundation root's `vault_inputs`); `bun run vault:fix` is the interactive way to fill the missing fields, apply that one secret through OpenTofu, and re-run the failed CI. These replace the earlier `WEB_CLIENT_GOOGLE_CLIENT_ID` / `WEB_CLIENT_GOOGLE_CLIENT_SECRET` fields: copy the existing values to the new names before applying, or the old fields are removed and the new ones are empty. Live validity and Google callback policy remain unverified. Google only needs the corresponding fixed broker callback, subject to its consent/branding policies. Applications never need these credentials.

The Vault root generates independent `AUTH_RELAY_SETUP_TOKEN_PRODUCTION` and `AUTH_RELAY_SETUP_TOKEN_NONPRODUCTION`. After Google sign-in, the first operator proves possession of that environment's setup token. The database's singleton bootstrap claim prevents reuse or a first-login takeover. Back up that claim with operators and sessions. Add a second operator through the UI before launch. Operator identity is the stable relay subject in that instance, never an email address. Recovery/removal of operators needs an audited administrative database procedure; self-service operator deletion is not implemented.

The realm root generates `AUTH_CONSOLE_CLIENT_ID`, `AUTH_CONSOLE_CLIENT_SECRET`, `AUTH_MANAGER_CLIENT_ID`, `AUTH_MANAGER_CLIENT_SECRET`; the Vault root stores these and `AUTH_RELAY_DATABASE_URL` in the appropriate document. Hosting reads them from Vault. Credentials/state/plans must stay encrypted and never be printed, committed or sent to application repositories. Required setup credentials are registered as generated Vault keys; normal checks validate registry/input ownership. `health --only auth` reads actual Vault documents to check Google and setup fields even while staged, and all console/database credentials regardless of the rollout flag. All console/database fields are checked even before deployment is enabled. Missing or blank fields fail by name, unavailable access skips; no environment-variable fallback masks missing Vault data. Presence is not a live credential validity test. Newly generated setup fields will be missing until a reviewed Vault apply.

Upstream, database, manager and console secret rotation require overlapping credentials/roles and a two-phase rollout. Established console sessions are opaque database-backed sessions and do not depend on an unchanged client secret, but an outstanding console code exchange can fail if its old secret is revoked early. No secret-overlap automation or live rotation test is claimed. Signing-key generations are managed through the realm root: activate a higher-priority key, retain the former verification key for the token lifetime plus JWKS cache/skew window, validate both, then retire separately. Never regenerate keys on startup. The pinned Keycloak provider requires managed realm name and internal ID to match.

## Consistency, restart and recovery

Runtime diagnostics follow the [shared service contract](../logger/README.md).
Every gateway response carries `X-Request-ID`; sign-in failure pages display the
same reference. Search JSON events by that ID and deployment/replica. Callback
steps identify transaction consumption, code exchange and session persistence;
cleanup logs identify logins, sessions, limits or client reconciliation with a
job ID, duration, safe cause and retry delay. Readiness reports database, identity
discovery and UI assets separately. Gateway-to-Keycloak requests include the
public HTTPS forwarding headers and correlation headers; no OAuth query, cookie,
token, verifier, raw database error detail or personal subject is logged.

For HTTPS callbacks, clearing a `__Host-` transaction/session cookie must retain
`Secure` and `Path=/`. Hono validates these attributes on deletion too; omitting
`Secure` throws before code exchange. The signed-token HTTPS regression tests
cover this independently of the HTTP-only local identity fixtures.

Bun login state, nonce, verifier and browser binding are stored in Postgres with a ten-minute lifetime and atomic single-use consumption. Opaque hashed console sessions and CSRF tokens live there too. Any Bun replica can complete a pending console callback; no process-local authentication state or filesystem persistence is used. Authorization-code exchanges have bounded timeouts and no retries. Back up both console and Keycloak schemas; test restoration together.

Registrations lock their database row while updating the private provider. Existing callbacks remain temporarily present upstream, and the database advances only after provider success. A failed write preserves the previous committed configuration. A network-ambiguous provider success can leave a superset upstream; public authorization/token endpoints permit only committed current/overlap destinations. Existing callback removal gets ten minutes' grace. Revocation/expiry is immediate at the gateway, including token exchange, independent of cleanup. Cleanup runs on all replicas using SKIP LOCKED, disables expired clients and removes stale login/session/rate records; ownership attributes prevent overwriting unrelated clients. The gateway denies unknown clients and fails closed during DB failure. Existing application sessions can remain usable independently.

Keycloak authentication sessions still depend on its replicated cache. Losing one replica can preserve a flow if another cache owner survives; losing the entire cluster may require a fresh login. Durable Bun login records do not fix Keycloak's upstream transaction durability. Actual Railway cluster discovery/private reachability, cache-owner failover and mixed-version rolling behavior require verification. Keycloak version upgrades may need maintenance rather than rolling deployment; follow upstream compatibility guidance and test backups first.

Remaining failure domains include the shared single-node PlanetScale branch, Railway's region/routing, DNS/TLS and Google for new sign-ins. Vault/OpenTofu availability affects provisioning/rotation, not each page load. Separate schemas do not remove the shared DB failure domain. Before launch, provide minute-resolution external synthetic sign-ins, readiness/latency/error/pool/backup alerts, per-client load testing and a tested alert destination. Daily health alone does not measure a 99.9% SLO.

References: [Keycloak production](https://www.keycloak.org/server/configuration-production), [cache behavior](https://www.keycloak.org/server/caching), [upgrade compatibility](https://www.keycloak.org/server/update-compatibility), [Railway private domains](https://docs.railway.com/networking/domains/working-with-domains), [OAuth security BCP](https://www.rfc-editor.org/rfc/rfc9700).

## Scoped registration credentials

[Agent onboarding](README.md#agent-registration) and the generated public
[consumer guide](https://www.chrisvouga.dev/llms.txt#6-auth-relay-google-sign-in)
cover the CLI/HTTP interface. The additive `agent_grants` table and nullable
`clients.agent_id` are Atlas-owned; apply a reviewed foundation schema plan before
deploying this gateway. Readiness checks those tables/columns as well as provider
and UI availability. An older gateway can ignore the additive data; do not drop it
as part of an application rollback.

The Vault root's `auth_agent_credentials` input is credential-delivery metadata
only, persisted with the complete `TOFU_VAULT_INPUTS`. Each entry generates a
48-character secret in `secret/auth-relay-agents/<id>/<config>` and a dedicated
read-only policy / exact repository-and-subject GitHub JWT role (five-minute TTL,
ten-minute maximum). No plaintext token is output or stored in the relay database.
Raw material also exists in encrypted OpenTofu state under its existing access and
backup controls. Use the nonsecret output fingerprint in **Agent access**; verify
ownership before approving origins. Runtime grants, client ownership, expiry and
audits are application data, never an infrastructure project allowlist.

`dev-read` previously matched every KV document. Its source now limits reads and
metadata listing to `personal/*`, matching the shared application boundary. Review
that policy change with the credential plan; users who depended on unrelated
namespaces need explicit, scoped OpenTofu policies. Existing administrators remain
trusted administrators. Shared CI and runtime read tokens do not receive these
new agent credentials. Never add them to service secret projections.

Rotate by incrementing an entry's generation, applying the reviewed saved plan,
then replacing the fingerprint on the existing runtime grant. In-flight registration
writes lock the grant through provider update/commit; rotation/revocation waits for
that transaction and subsequent old-token writes are rejected. Agent admission is
rate-limited by a credential hash and a global ceiling. A revoked or expired grant
stops management requests; application revocation is separate and established
consumer sessions follow application policy. Grant/project identities are immutable;
only the operator can replace a fingerprint and preserve its client ownership.
No live credential generation, scope approval or Google validation is implied by
local tests. Keep the remaining production acceptance gates in force.
