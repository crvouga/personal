# OpenTofu infrastructure

OpenTofu 1.13.0 is the only infrastructure manager. Resources are declared with published providers; no provisioning scripts, reconciler, shell provisioners or alternate IaC exist. Image building, local daemon startup, secret reads and HTTP probes remain application operations.

The canonical inventory is [modules/inventory/inventory.tf.json](modules/inventory/inventory.tf.json), in `locals.inventory`. It is OpenTofu JSON syntax, consumed directly by OpenTofu and read-only documentation/build adapters. There is no parallel YAML inventory.

All 14 domains remain managed through Squarespace Domains, retaining their existing registrar identities (including the Tucows reseller registration). The Cloudflare migration is cancelled; only the four original Cloudflare DNS zones are retained in `foundation/domains.tf`. Transfer initiation, registrar-setting resources and Squarespace migration operations have been removed. See the [cancellation record](../docs/domain-migration.md). Original encrypted owner-operation states and migration evidence remain in ignored private storage for recovery; do not replay old plans.

| Root         | Owns                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `state`      | R2 state bucket and scoped state access token; encrypted local bootstrap state                                                                                                                                                                                                                                                                                                                                                                                                         |
| `foundation` | Cloudflare zone/DNS/NEL/settings/redirects/firewall rules, shared R2 buckets and credentials, tunnel/remote ingress/DNS, Railway project/default-environment policy and Vault hosting, PlanetScale Postgres branch/role, the `fleet` schema (`postgresql_schema`) and the Atlas schemas inside `secret_store` and `fleet`, every platform GitHub repository and its settings/security/Actions permissions, workspace rules/collaborators/labels/secrets/variables, and publisher files |
| `bootstrap`  | Original OpenBao initialization material and provider-managed serial Shamir unseal requests                                                                                                                                                                                                                                                                                                                                                                                            |
| `vault`      | KV mount, policies, GitHub JWT auth/roles, userpass users, periodic runtime token, generated credentials, complete dev/prd KV documents (including the generated fleet API credentials) and the `fleet/<role>` documents (`fleet_age_keys` plus a generated `api_token`)                                                                                                                                                                                                               |
| `fleet`      | Every remaining Railway service (including `fleet-api`), image revision, environment variables, domain and DNS record                                                                                                                                                                                                                                                                                                                                                                  |

All state and saved plans are encrypted with OpenTofu's PBKDF2/AES-GCM support. `foundation`, `bootstrap`, `vault` and `fleet` use locked R2 S3 backends. The legacy Fly API returned no apps, so there are no surviving Fly resources to adopt.

`state` keeps its own encrypted local state to break the backend bootstrap cycle; back it up outside the repository with its passphrase. Never delete the only copy of that state.

## Existing fleet migration

Production adoption completed on 2026-10-01. All five roots were imported or adopted, applied, and verified with zero-change plans before enabling `TOFU_MIGRATION_READY`. Existing service identities, image revisions, database contents and the admin password were preserved. The original initialization record and encrypted bootstrap state are backed up outside the repository.

The steps below document adoption for recovery or another environment. Import blocks declare identities; verify the actual state and plans before enabling CI in any new environment. Obtain the original OpenBao initialization record and existing credentials securely, and preserve them throughout adoption.

1. Install OpenTofu 1.13.0 and the [Atlas CLI](https://atlasgo.io/getting-started). Atlas uses a local disposable PostgreSQL dev database (`schema_dev_url`), defaulting to Docker's PostgreSQL 18. Supply a suitable dev URL if Docker is unavailable.
2. Use a password manager to create a random state passphrase of at least 32 characters. Supply `TF_VAR_state_passphrase`, `TF_VAR_cloudflare_account_id` and `TF_VAR_cloudflare_api_token` without committing values.
3. Initialize and plan `state`; apply its saved plan. Set `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` from its sensitive `access_key_id` / `secret_access_key` outputs. Set the matching `TF_VAR_state_access_key` / `TF_VAR_state_secret_key` for the GitHub bootstrap bindings. Preserve the encrypted local state and the passphrase independently.
4. Create an ignored `backend.backend.json` in each remote root. Use the example below, changing the root's state key. Initialize each root with `-backend-config=backend.backend.json`. Supply the same settings without `key` as `TF_VAR_state_backend` in `vault` and `fleet`. Credentials come from the AWS environment; never embed them in backend configuration.
5. Supply required provider inputs using ignored tfvars or `TF_VAR_*`. `foundation` requires an account-scoped Railway token, a GitHub PAT with repository/Actions/workflow permissions, the PlanetScale service token id and token, and `vault_inputs`. `vault_inputs` is JSON containing **complete** `secrets.dev`, `secrets.prd` and `admin_passwords`. Export every existing KV field into that input before adopting KV resources; applying a partial map would remove omitted fields. Do not log or commit the export. Derived infrastructure fields and generated runtime credentials are managed by resources and override matching manual fields. `DATABASE_URL` is one of those derived fields: both KV documents take the foundation database URL.
6. Import the existing Railway project. Import every service, custom domain and existing variable collection using the addresses below. The PlanetScale branch resource creates the database `personal` when it is absent. Keep current image tags and current schema configuration while adopting. Add import blocks for remaining existing resources rather than allowing duplicate creation. Atlas owns the contents of `secret_store` and `fleet` only (each resource is scoped by `search_path`); its `secret_store` schema preserves the storage tables and migration-history table. Inspect its schema diff for destructive changes.
7. Import `bootstrap`'s `vaultoperator_init.vault` from a protected file containing the original initialization output (`keys`, `keys_base64`, `root_token`). Recover it from the existing `crvouga.kv` record through a trusted database session if necessary. **Do not initialize a new seal against the existing database.** The encrypted bootstrap state replaces the old script's reliance on that database row. The row is retained as application data; no script mutates it.
8. Import the KV mount, policies, auth backends/roles, users and both KV documents into `vault`. The current runtime token can be replaced with the managed periodic token only as part of a reviewed rotation. Preserve existing `TURBO_TOKEN` and 9router credentials in `secrets` during adoption so clients keep working.
9. Review saved plans for all roots. Resolve every proposed destroy/replacement and duplicate before applying. Apply in order: `foundation`, `bootstrap`, `vault`, `fleet`, serially with `-parallelism=1`. Then verify every public endpoint and a remote-cache write/read. Set the foundation input `migration_ready = true` and apply it only after adoption and checks; it enables the OpenTofu-managed `TOFU_MIGRATION_READY` repository variable. CI fails closed until this variable is true.

Example backend (non-secret; `foundation.tfstate` is root-specific):

```json
{
  "bucket": "crvouga-tofu-state",
  "key": "foundation.tfstate",
  "region": "auto",
  "endpoints": { "s3": "https://<account-id>.r2.cloudflarestorage.com" },
  "skip_credentials_validation": true,
  "skip_region_validation": true,
  "skip_requesting_account_id": true,
  "skip_metadata_api_check": true,
  "use_path_style": true,
  "use_lockfile": true
}
```

```bash
tofu -chdir=packages/infra/tofu/foundation init -backend-config=backend.backend.json
tofu -chdir=packages/infra/tofu/foundation plan -parallelism=1 -out=adopt.tfplan
tofu -chdir=packages/infra/tofu/foundation apply -parallelism=1 adopt.tfplan
```

Import addresses (quote module addresses containing brackets):

| Resource            | Address                                                      | Provider import ID                                                    |
| ------------------- | ------------------------------------------------------------ | --------------------------------------------------------------------- |
| Railway project     | `railway_project.workspace` in foundation                    | Project UUID                                                          |
| Postgres branch     | `planetscale_postgres_branch.openbao` in foundation          | `{"database":"personal","id":"<branch id>","organization":"crvouga"}` |
| Vault service       | `module.vault_service.railway_service.this` in foundation    | Service UUID                                                          |
| Fleet service       | `module.service["<id>"].railway_service.this` in fleet       | Service UUID                                                          |
| Custom domain       | Same module, `railway_custom_domain.this`                    | `<service-id>:production:<hostname>`                                  |
| Variable collection | Same module, `railway_variable_collection.this`              | `<service-id>:production:<var-name>:...`                              |
| Cloudflare zone     | `cloudflare_zone.primary` in foundation                      | Zone ID                                                               |
| R2 bucket           | `cloudflare_r2_bucket.shared["development" or "production"]` | `<account-id>/<bucket>/default`                                       |
| Tunnel              | `cloudflare_zero_trust_tunnel_cloudflared.router`            | `<account-id>/<tunnel-id>`                                            |
| Custom firewall     | `cloudflare_ruleset.custom["<id>"]`                          | `zones/<zone-id>/<ruleset-id>`                                        |
| GitHub repository   | `github_repository.workspace` or `.application["<name>"]`    | Repository name                                                       |
| GitHub repo policy  | Actions/workflow permissions, collaborators and labels       | Repository name                                                       |
| GitHub environment  | `github_repository_environment.application["<repo>:<name>"]` | `<repo>:<environment>`                                                |
| GitHub secret       | `github_actions_secret.repository["<repo>:<name>"]`          | `<repo>:<secret-name>`                                                |
| Init material       | `vaultoperator_init.vault` in bootstrap                      | `file:///absolute/path/to/protected-init.json`                        |
| KV mount            | `vault_mount.secret` in vault                                | `secret`                                                              |
| Policy              | `vault_policy.this["<name>"]`                                | Policy name                                                           |
| JWT auth            | `vault_jwt_auth_backend.github`                              | `jwt`                                                                 |
| JWT role            | `vault_jwt_auth_backend_role.github["github-actions"]`       | `auth/jwt/role/github-actions`                                        |
| JWT role (fleet)    | `vault_jwt_auth_backend_role.github["fleet-enroll"]`         | Created by the plan; nothing exists to import                         |
| Userpass user       | `vault_generic_endpoint.admin["<username>"]`                 | `auth/userpass/users/<username>`                                      |
| Userpass auth       | `vault_auth_backend.userpass`                                | `userpass`                                                            |
| KV document         | `vault_kv_secret_v2.personal["dev" or "prd"]`                | `secret/data/personal/<config>`                                       |

Providers without import support (Railway settings) adopt existing configuration through their initial create/update operation; review their desired values before applying. A locally managed tunnel must be migrated to remote ingress without replacing its UUID; verify the Cloudflare provider's plan and connector cutover before applying.

Cloudflare 5.26.0 also cannot import `cloudflare_zone_dns_settings`. Its initial create operation edits the existing zone's singleton DNS settings; review that update rather than adding an unsupported import block. SOA and nameserver TTL overrides require Cloudflare Enterprise entitlement. The inventory deliberately omits them so the provider preserves Cloudflare defaults rather than submitting unsupported custom settings.

The Postgres branch is `PS_5_AWS_ARM` in `us-east` on PostgreSQL 18 with `replicas = 0`: one primary and no replicas, the cheapest single-node network-attached size. The published PlanetScale provider creates that database from `planetscale_postgres_branch` and reports the replica count, but it does not send a replica count on create. PlanetScale then defaults the branch to two replicas. The branch postcondition rejects any other count before the connection URI is published. Resize the existing branch to the inventory count; replacing it creates the default count again. The role inherits `postgres` so Atlas and the applications can keep creating schemas. Direct connections use `sslmode=require`. `DB_CONNECTION_URI` and `DATABASE_URL` are the same URL; the Vault entrypoint and the Atlas schema resource add `search_path=secret_store` themselves.

## Public image pulls

All container images must be public and anonymously pullable. The inventory
rejects private registry credentials, and `bun run health --only images` checks
anonymous GHCR pulls without requiring Vault access. Railway's private registry
feature requires a paid plan and is not used.

The shared publisher prefers the OpenTofu-managed `DEPLOY_DISPATCH_TOKEN`,
whose PAT needs `write:packages` as well as repository/workflow access. Existing
packages can be linked to a different repository, so a caller's `GITHUB_TOKEN`
may lack package write permission despite `packages: write`. The caller token
remains a fallback when no platform token is supplied.

## Fleet API (`fleet-api`)

`packages/fleet-api` is a Hono + Bun service on Railway at `https://fleet.chrisvouga.dev`. Fleet nodes send heartbeats to it and it serves the dashboard; the wire contract is `packages/fleet-api/PROTOCOL.md`. It is an ordinary inventory entry (`services[id = "fleet-api"]`), so everything that enumerates services handles it with no special case: the publish matrix (this repository builds its image from `packages/fleet-api/Dockerfile`, context `.`), the `fleet` root's `module.service`, the Cloudflare CNAME and Railway domain-verification TXT records, the health probe (`GET /health`, port 8080), the integration guide and `bun run health`.

| Resource                                                                                             | Root         | Notes                                                                                                       |
| ---------------------------------------------------------------------------------------------------- | ------------ | ----------------------------------------------------------------------------------------------------------- |
| `module.service["fleet-api"]` (service, domain, variables, DNS)                                      | `fleet`      | New resources, created by the plan. See "First deploy".                                                     |
| `postgresql_schema.fleet`                                                                            | `foundation` | The single `CREATE SCHEMA fleet`. `if_not_exists`, `prevent_destroy`, no cascade.                           |
| `atlas_schema.fleet`                                                                                 | `foundation` | Every table, column, index and constraint, from `packages/fleet-api/schema.hcl`. `prevent_destroy`.         |
| `random_password.fleet_admin` / `fleet_session` / `fleet_role_token["<role>"]`                       | `vault`      | 48 character alphanumeric credentials; roles `ci`, `web`, `cache`, `netboot`, `devbox`.                     |
| `FLEET_ADMIN_TOKEN`, `FLEET_SESSION_SECRET`, `FLEET_ROLE_TOKEN_HASHES` in `secret/data/personal/prd` | `vault`      | Read by the `fleet` root and copied into the Railway service variables. Production only.                    |
| `api_token` in `secret/data/fleet/<role>`                                                            | `vault`      | The raw role token, next to the existing `age_key`. Only roles present in `fleet_age_keys` have a document. |

### Secrets

- `FLEET_ROLE_TOKEN_HASHES` is `jsonencode({ role => sha256(token) })`. The service only ever holds hashes, and compares `sha256(presented token)` to the hash for the role the node claims. The raw tokens are written only to `secret/data/fleet/<role>`.
- A new node receives its role's `api_token` together with its `age_key` in the existing single-use, response-wrapped enrollment token. The `fleet-enroll` JWT role and policy are unchanged: a wrapped read of `secret/data/fleet/+`, nothing else, so the workflow never holds either secret unwrapped.
- `DATABASE_URL` is the existing foundation database URL (the same entry the other applications use). The service names `fleet.<table>` in every statement; it never creates objects.
- `FLEET_ADMIN_TOKEN` also authorizes the read-only `fleet-nodes` health group (`bun run health --only fleet-nodes`); export it, or let the group read it from the production KV document with the Vault token the report already uses. Without it the group reports `SKIP`.
- Rotating a role token means replacing its `random_password` (`tofu apply -replace`, reviewed). The hash and the node-side value change together in the same vault apply; enrolled nodes keep working because they authenticate with their own node secret, and the role token is only used to register.

### Database isolation (read before touching `fleet-database.tf`)

The Postgres database is shared with other projects, so the fleet API is confined to the schema `fleet`. These rules were verified with the real Atlas CLI and the real Atlas OpenTofu provider 0.10.3 against a scratch database containing decoy schemas:

1. **Never point an Atlas resource at the database without `search_path`.** Without it Atlas works in database (realm) mode, diffs every schema against the HCL and plans `DROP SCHEMA public CASCADE` and its siblings. In the test it destroyed the decoy data. `exclude` globs did not prevent it, and `include` needs Atlas Pro. `atlas_schema.fleet` therefore uses `"${local.database_url}&search_path=fleet"`, exactly like `atlas_schema.openbao` uses `secret_store`.
2. **Never use `atlas_migration`.** Without `dev_url` it cleans (wipes) the target database; with `dev_url` it runs `atlas migrate lint`, which is Atlas Pro only and fails. There is no migrations directory, and there must not be one.
3. **A scoped `atlas_schema` only works if the schema already exists.** Atlas answers `schema "fleet" was not found`, and `schemas = ["fleet"]` in an env config fails in the provider's dry-run. So the work is split, and the split is real: OpenTofu's PostgreSQL provider (`postgresql_schema.fleet`) runs the one `CREATE SCHEMA`, and Atlas owns everything inside it (tables, columns, indexes, constraints). `atlas_schema.fleet` depends on the schema resource. The provider connects as the PlanetScale `owner` role, which inherits `postgres` and may create schemas (see the Postgres notes above); `superuser = false` and `sslmode = "require"`.
4. `schema.hcl` declares only `schema "fleet" {}`. Do not add objects in other schemas, and keep Atlas's `dev_url` (`schema_dev_url`, a disposable local PostgreSQL) separate from the real database.

`foundation.tftest.hcl` asserts the schema resource, the `search_path=fleet` URL, that the HCL is read from the package and declares only the `fleet` schema.

### First deploy

Nothing was applied from the change that introduced this section; it was validated with `bash packages/infra/tofu/check.sh`, the unit tests and mocked provider plans only. The first rollout, in the usual order:

1. Merge to `main`. The `publish` filter includes `packages/fleet-api/**`, so CI builds and pushes `ghcr.io/crvouga/chrisvouga-fleet-api:<sha>` and `latest` before deploying. The `check` job installs the Atlas CLI because the fleet API tests apply `schema.hcl` to a throwaway PostgreSQL.
2. `vault` root: review the saved plan. It adds the generated credentials to `personal/prd` and an `api_token` to each `fleet/<role>` document; nothing is removed. Apply it before `fleet`, which reads those keys.
3. `foundation` root, with the Atlas CLI installed and `schema_dev_url` reachable: the plan creates `postgresql_schema.fleet` and `atlas_schema.fleet`. Read the Atlas diff; it must list only `fleet.*` objects. A drop of any other schema means the URL lost its `search_path`: stop. The root also needs to download the `cyrilgdn/postgresql` provider (1.26.0, locked).
   The CI OpenTofu action creates the empty schema from a guarded saved plan before its full foundation plan; it refuses any change except creating `postgresql_schema.fleet`. For manual operations, if the first full plan fails with `schema "fleet" was not found`, `depends_on` has not helped: Atlas inspects the target during planning. Review and apply a saved foundation plan targeting only `postgresql_schema.fleet`, then review and apply a new full foundation plan. Keep `search_path=fleet` throughout; never use an unscoped Atlas URL to work around the missing schema. The [bring-up procedure](../../fleet/docs/readiness.md#first-foundation-schema-plan) has the exact commands.

4. `fleet` root: creates the Railway service, custom domain, variables and both DNS records. **No imports are needed**; a brand-new service has nothing to adopt, and `image_tags` is completed with the default tag by the action. Do not add import blocks for it.
5. Check `https://fleet.chrisvouga.dev/health`, then `bun run health --only services,fleet-nodes`.

CI runs foundation, bootstrap and vault before fleet in `deploy-reconcile`, so a merge performs steps 2 to 4 in that order once `TOFU_MIGRATION_READY` is true.

## External application ownership

External application repositories own their database schemas and migrations,
image publisher workflows, and application validation. This platform owns the
shared database and hosting services, DNS, secret delivery, and generic
repository policy. Keep application behavior out of platform resource logic.

Set `managed_publisher = false` in a repository's inventory entry when it owns
its publisher. The repository can still call the shared image build/deploy
workflow. `required_status_checks` declares default-branch checks generically.
Vault registry entries with `generated = true` receive independent generated
secrets in their declared `configs`; their values survive resource renames.

Pickflix's schema and publisher ownership transfers to `crvouga/pickflix-v1`.
The foundation `removed` blocks use `destroy = false`: applying them only forgets
ownership, preserving the live `pickflix` schema, tables, data and publisher file.
The app adopts existing tables in place and supplies its missing primary keys.
Its migrations remain confined to `pickflix`, without a `public` fallback.
Apply this ownership handoff before merging the application migration PR, so
image deployment cannot reconcile the old schema and remove the new keys.
The branch ruleset and generated credentials move to generic resource addresses;
review the saved plans to confirm no table destruction, credential rotation,
workflow overwrite or branch protection removal.

## Normal operations

`bun run infra`, `infra:bootstrap`, `infra:vault`, `infra:fleet` and `infra:state` forward arguments directly to OpenTofu. Review with `plan`; apply the reviewed saved plan. Stateful resources use `prevent_destroy`; decommissioning requires an explicit reviewed OpenTofu change, never an API deletion script.

CI uses [.github/actions/tofu](../../../.github/actions/tofu/action.yml) for initialization, saved plans and serialized applies. It preserves all existing service image revisions when changing a subset of services. Local fleet plans must supply the complete deployed `image_tags` map from `tofu output -json image_tags`; incomplete maps fail validation. A service that was just added to the inventory has no output yet: the action and `bun run health --drift` add it at `default_image_tag`, so supply it the same way locally. Application image building remains Docker CI work. All platform images must be public. Railway pulls GHCR images anonymously; the inventory rejects private registry credentials, and `bun run health --only images` verifies anonymous pulls. There is no visibility-setting bypass script or dashboard instruction.

GitHub publisher files are `github_repository_file` resources rendered from [the shared template](modules/inventory/publish.yml.tftpl). The integration guide renders that same template. Resource edits, new hosting entries and secret values all go through OpenTofu.

The foundation root is authoritative for every platform repository's configurable GitHub control plane. Every repository has managed metadata and features, default branch, Actions policy and default workflow-token permissions, security scanning, vulnerability alerts and Dependabot security updates. The workspace repository additionally owns its ruleset, collaborators, issue labels, Actions secrets and Actions variables. The `main` ruleset requires a pull request, the `Required` and `Fleet` checks, and a merge queue whose method is `MERGE`. Direct pushes and force pushes stay refused. Git history, pull requests, issues, workflow runs, releases, packages and artifacts are application or collaboration data rather than infrastructure resources.

The pinned GitHub 6.13.0 provider exposes non-provider secret patterns in its schema but does not send or read that setting. It is deliberately omitted from desired settings until a provider supports its full lifecycle; declaring it produces perpetual drift. Secret scanning and push protection remain explicitly managed. Railway environment reads include both environment and project IDs so the GraphQL provider can preserve every mutation input across refreshes.

Repository secret names are declared in `github.repositories[*].actions_secrets` in the inventory. Their values already live in GitHub Secrets. OpenTofu lists metadata and imports existing secrets without needing or copying plaintext values into Vault. It ignores secret value and rotation timestamp changes, and prevents deletion; a missing name is omitted from adoption and reported in `unavailable_repository_secrets`. The schema-only empty value is never written during adoption, as verified with the real pinned provider against a mock API that rejects every mutation. Bootstrap credentials and newly generated secrets retain their existing OpenTofu value ownership.

Optional credential-dependent integration checks report `SKIP` for missing, malformed or rejected credentials and continue independent checks. CI runs these in `secret-integrations`, outside the core `check` / `Required` gate. Local `check:ci` attempts a bounded Vault read and always runs core checks with local caching. Actual core failures still fail the suite; an active deployment's required credentials and production smoke test still fail that deployment. Public health probes and fleet OpenTofu deploys do not import unrelated third-party credentials.

The credentials that let OpenTofu reach each provider, the state-encryption passphrase and the initial state-backend credentials are bootstrap trust anchors. They must be supplied from outside the state they unlock. Scoped credentials created after that boundary—including state and object-store tokens—are OpenTofu resources.

`bun run health --drift` reports drift without applying anything: it runs `tofu plan -lock=false -detailed-exitcode` in every initialized root (one with `backend.backend.json` and its inputs, as in the migration steps above), prints only the addresses that would change, and writes no plan file. It needs the deployed `vault_image_tag` and `image_tags`; when `TF_VAR_vault_image_tag` / `TF_VAR_image_tags` are unset it reads them from `tofu output`. CI's [Infra health workflow](../../../.github/workflows/infra-health.yml) does this daily through the tofu action's `prepare` mode, which initializes a root and stops before planning or applying.

Validate with `bun run check:infra`; regenerate the integration guide with `bun run llms:sync`. Never commit state, saved plans, initialization files, secret tfvars or credentials.
