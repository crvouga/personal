# Auth relay operations

The objective is 99.9% availability of new sign-ins per calendar month, including upstream failures (43.2 minutes per 30 days). This is a target, not an achieved SLA. Local application sessions remain independent and never silently fail open.

## Ownership and isolation

OpenTofu exclusively manages infrastructure. `foundation/auth-relay.tf` defines restricted roles and isolated schemas in the existing shared PlanetScale PostgreSQL database. Atlas owns console tables through `schema.hcl`, with `search_path=auth_relay_production` or `auth_relay_nonproduction`; never remove that scoping or point Atlas at the whole database. Runtime roles receive USAGE on their schema and DML/sequence privileges on their tables, not CREATE or access grants to other application schemas. Keycloak internal tables use separate `auth_production` / `auth_nonproduction` schemas. No dedicated database or persistent container volume is introduced.

The UI owns consuming application records, exact callbacks, expiries and operators as runtime data. This is the explicit auth-relay exception to the former infrastructure-managed registration approach, not permission for an application to provision cloud resources. `auth` bootstraps only realms, Google upstreams, signing keys, the console login client and its private registration service account. Never manage the same consuming client from OpenTofu and the UI. The old GitHub registration/expiry workflow and inventory project allowlists have been removed.

`auth-hosting` declares two always-on public Bun/Hono replicas per instance and two private Keycloak replicas. Only Hono owns the public hostname. Keycloak gets no public domain or DNS; its admin API and management metrics stay private. Keep untrusted workloads out of the broker's private Railway project/environment: private networking is a trust boundary. Hono proxies the configured realm/resources, not `/admin` or dynamic registration. The realm-scoped manager can manage clients but cannot manage users or realms; its secret never reaches the browser. Production and nonproduction should ultimately use separate private network environments for stronger isolation; separate services/schemas alone do not provide a network boundary inside the existing shared Railway environment.

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

Keep `auth_relay.enabled=false` until acceptance gates pass. It is a rollout gate, not a reversible teardown flag; database resources have prevent_destroy. Use immutable image digests, reviewed saved plans, encrypted state and serial Railway operations (`-parallelism=1`). Public image: repository-root build context, `packages/auth-relay/Dockerfile`. Private image: `packages/auth-relay/Dockerfile.keycloak`, package build context. Build the UI with Bun; the production image serves compiled JS with its Hono API from the same origin.

Deployment requires access to the existing encrypted remote state: its state
passphrase, backend access credentials/configuration, provider credentials and
current Vault input document. These are bootstrap trust anchors supplied through
the established deployment environment, not generated by local startup or read
from GitHub secret values. Without them a local command cannot initialize the
correct state, review a saved plan or apply safely. Do not use a new empty state
or fresh encryption key to bypass missing access. No remote backend/inputs or
bootstrap state credentials were available in the local environment during the
2026-10-16 investigation; no deployment apply was attempted.

First adoption requires a staged plan: foundation roles/empty schemas, then schema-scoped Atlas tables/grants; private identity service and reviewed Keycloak initial migration; `auth` realm bootstrap using a private trusted administration connection; Vault projection of system credentials; full hosting plan. Use a reviewed targeted plan for the private identity service only during bootstrap, never an unchecked normal deployment shortcut. `auth-production.tfstate` and `auth-nonproduction.tfstate` are independent encrypted realm states. Vault reads them only when enabled. Do not enable the public gateway before its dependencies exist.

**Keycloak's initial table/changelog migration and safe version-upgrade strategy remain unresolved production gates.** The production image deliberately validates its schema and must not initialize/update it on startup. Do not work around this using shell provisioners or manual DDL. The disposable test fixture permits upstream initialization; it is not a deployment procedure. Foundation's existing automatic empty-schema bootstrap handles fleet only; auth's initial schema creation still needs a separately reviewed targeted OpenTofu plan before Atlas inspection. Import any already-existing schema/role before adoption; never replace live resources.

Bun readiness `/health/ready` checks its schema and private-provider discovery; liveness `/health/live` is process-only. Bounded DB pools, request sizes, upstream timeouts and database-backed per-client/global admission limits contain overload. These are initial limits, not proof of fair capacity under hostile traffic. SIGTERM stops accepting requests and drains them before database shutdown, with a 25-second deadline. Railway overlap/drain settings are 60 seconds with automatic failure restart. Verify actual routing and termination in deployment; declarations alone are not evidence.

## Verified email claims

Fleet authorizes only verified Google emails. The Google provider enables
`trust_email` so Keycloak preserves Google's `email_verified` assertion rather
than requiring a second broker email-verification flow. It still uses the
standard first-broker-login confirmation flow, with no automatic email account
linking. A verified email grants neither relay operator access nor Fleet access;
those permissions remain separate database-owned decisions. Existing unverified
broker users need review before live rollout. The pinned provider's behavior is
specified in [Keycloak's OIDC implementation](https://github.com/keycloak/keycloak/blob/26.8.1/services/src/main/java/org/keycloak/broker/oidc/OIDCIdentityProvider.java#L1071).

## Credentials and bootstrap

Reuse existing `WEB_CLIENT_GOOGLE_CLIENT_ID` / `WEB_CLIENT_GOOGLE_CLIENT_SECRET` from `secret/data/personal/{dev|prd}`. They have been observed present in both documents without printing values; live validity and Google callback policy remain unverified. Google only needs the corresponding fixed broker callback, subject to its consent/branding policies. Applications never need these credentials.

The Vault root generates independent `AUTH_RELAY_SETUP_TOKEN_PRODUCTION` and `AUTH_RELAY_SETUP_TOKEN_NONPRODUCTION`. After Google sign-in, the first operator proves possession of that environment's setup token. The database's singleton bootstrap claim prevents reuse or a first-login takeover. Back up that claim with operators and sessions. Add a second operator through the UI before launch. Operator identity is the stable relay subject in that instance, never an email address. Recovery/removal of operators needs an audited administrative database procedure; self-service operator deletion is not implemented.

The realm root generates `AUTH_CONSOLE_CLIENT_ID`, `AUTH_CONSOLE_CLIENT_SECRET`, `AUTH_MANAGER_CLIENT_ID`, `AUTH_MANAGER_CLIENT_SECRET`; the Vault root stores these and `AUTH_RELAY_DATABASE_URL` in the appropriate document. Hosting reads them from Vault. Credentials/state/plans must stay encrypted and never be printed, committed or sent to application repositories. Required setup credentials are registered as generated Vault keys; normal checks validate registry/input ownership. `health --only auth` reads actual Vault documents to check Google and setup fields even while staged, and all console/database credentials regardless of the rollout flag. All console/database fields are checked even before deployment is enabled. Missing or blank fields fail by name, unavailable access skips; no environment-variable fallback masks missing Vault data. Presence is not a live credential validity test. Newly generated setup fields will be missing until a reviewed Vault apply.

Upstream, database, manager and console secret rotation require overlapping credentials/roles and a two-phase rollout. Established console sessions are opaque database-backed sessions and do not depend on an unchanged client secret, but an outstanding console code exchange can fail if its old secret is revoked early. No secret-overlap automation or live rotation test is claimed. Signing-key generations are managed through the realm root: activate a higher-priority key, retain the former verification key for the token lifetime plus JWKS cache/skew window, validate both, then retire separately. Never regenerate keys on startup. The pinned Keycloak provider requires managed realm name and internal ID to match.

## Consistency, restart and recovery

Bun login state, nonce, verifier and browser binding are stored in Postgres with a ten-minute lifetime and atomic single-use consumption. Opaque hashed console sessions and CSRF tokens live there too. Any Bun replica can complete a pending console callback; no process-local authentication state or filesystem persistence is used. Authorization-code exchanges have bounded timeouts and no retries. Back up both console and Keycloak schemas; test restoration together.

Registrations lock their database row while updating the private provider. Existing callbacks remain temporarily present upstream, and the database advances only after provider success. A failed write preserves the previous committed configuration. A network-ambiguous provider success can leave a superset upstream; public authorization/token endpoints permit only committed current/overlap destinations. Existing callback removal gets ten minutes' grace. Revocation/expiry is immediate at the gateway, including token exchange, independent of cleanup. Cleanup runs on all replicas using SKIP LOCKED, disables expired clients and removes stale login/session/rate records; ownership attributes prevent overwriting unrelated clients. The gateway denies unknown clients and fails closed during DB failure. Existing application sessions can remain usable independently.

Keycloak authentication sessions still depend on its replicated cache. Losing one replica can preserve a flow if another cache owner survives; losing the entire cluster may require a fresh login. Durable Bun login records do not fix Keycloak's upstream transaction durability. Actual Railway cluster discovery/private reachability, cache-owner failover and mixed-version rolling behavior require verification. Keycloak version upgrades may need maintenance rather than rolling deployment; follow upstream compatibility guidance and test backups first.

Remaining failure domains include the shared single-node PlanetScale branch, Railway's region/routing, DNS/TLS and Google for new sign-ins. Vault/OpenTofu availability affects provisioning/rotation, not each page load. Separate schemas do not remove the shared DB failure domain. Before launch, provide minute-resolution external synthetic sign-ins, readiness/latency/error/pool/backup alerts, per-client load testing and a tested alert destination. Daily health alone does not measure a 99.9% SLO.

References: [Keycloak production](https://www.keycloak.org/server/configuration-production), [cache behavior](https://www.keycloak.org/server/caching), [upgrade compatibility](https://www.keycloak.org/server/update-compatibility), [Railway private domains](https://docs.railway.com/networking/domains/working-with-domains), [OAuth security BCP](https://www.rfc-editor.org/rfc/rfc9700).
