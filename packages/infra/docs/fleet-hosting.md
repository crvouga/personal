# Fleet container hosting

The operator superseded issue #162's native-only restriction with the platform's
standard Docker/GHCR publishing contract on 2026-10-27. The standalone application
remains Bun + SQLite + Litestream; it has no PostgreSQL backend or application-side
Vault dependency. Application code, migrations and publisher workflow belong to
`crvouga/fleet`.

## Release evidence

The first published implementation is Fleet commit
`871a0f3a532d941c82ce0f126d73e560e9943a2d`, image
`ghcr.io/crvouga/chrisvouga-fleet-api:871a0f3a532d941c82ce0f126d73e560e9943a2d`, digest
`sha256:181e1503558a0e6069ff0d4d18bdbf2d53d654038b6bfcbe46c533bc5b8bf4e4`.
An anonymous registry read confirmed `linux/amd64`, the supervisor entrypoint and
approximately 127 MiB compressed image layers. Fleet's container job passed a
secret-free build, configuration refusal, readiness, graceful shutdown, ordinary
restart, fresh-container S3 restore and denied-write startup checks using Moto.
Its complete CI workflow also passed, including Nix and all installer platforms.

The operator explicitly authorized the initial browser owner through Fleet's
`bun run access:allow` CLI before first production activation. With no controller
running, the operator restored/initialized the working database using Fleet's
published runtime code, applied the authorization, synchronized with Litestream
0.5.17 to the real private R2 prefix, and verified a fresh offline restore contains
the authorization and passes SQLite `integrity_check`. The allowlist remains
runtime data in SQLite; it is not an inventory allowlist. This real R2 check ran
on the operator's macOS machine; the Linux container acceptance used Moto.

## Hosting and secrets

Reuse the `fleet-api` service id and `fleet.chrisvouga.dev` hostname. The former
Railway service was deleted during application retirement. Production CI run
`40636864245` completed the stale-domain recovery with exactly one forget action
and no other changes in that recovery plan; the complete workflow passed. The
replacement uses `state_key = "fleet-controller"`, preserving the old retirement
records under their original addresses without capturing the new service. Public
service ids, image names, aliases and deployment inputs remain `fleet-api`.
Adopt any remaining live resources instead of duplicating them. The services root
retains the shared `fleet.tfstate` backend key.

The first activation uses inventory `initial_image_tag`; later publisher dispatches
select their commit tags. OpenTofu owns the source image, service, volume, variables
and DNS. Railway never builds this application from source.

The volume is the writable SQLite working directory and enforces Railway's
single-deployment mount behavior. Run exactly one replica without sleep. The
Docker image defaults to the `bun` user; Railway runs this service with UID 0
because its attached volume starts with root ownership. The working file is
`/var/lib/fleet/fleet.db`, retained with WAL/SHM and Litestream metadata across
ordinary restarts. R2 replication remains necessary for replacement-volume recovery.
Startup readiness has a 180-second budget and shutdown has 60 seconds.

The retired `FLEET_ADMIN_TOKEN` Vault value was confirmed absent. A new generated
`FLEET_CONTROLLER_ADMIN_TOKEN` is mapped to Fleet's runtime `FLEET_ADMIN_TOKEN`;
this does not rotate another active service's credential. Shared R2 bindings use
source-key aliases rather than duplicate values:

| Vault key                      | Runtime variable        |
| ------------------------------ | ----------------------- |
| `FLEET_CONTROLLER_ADMIN_TOKEN` | `FLEET_ADMIN_TOKEN`     |
| `S3_BUCKET`                    | `FLEET_S3_BUCKET`       |
| `S3_ENDPOINT`                  | `FLEET_S3_ENDPOINT`     |
| `S3_REGION`                    | `AWS_REGION`            |
| `S3_ACCESS_KEY_ID`             | `AWS_ACCESS_KEY_ID`     |
| `S3_SECRET_ACCESS_KEY`         | `AWS_SECRET_ACCESS_KEY` |

All replica objects use `fleet-api/production`. No bucket, shared credential,
database resource or lifecycle policy is replaced. Do not inject removed backend
settings, `DATABASE_URL`, `VAULT_ADDR`, `FLEET_SESSION_SECRET` or
`FLEET_ROLE_TOKEN_HASHES`. Enrollment is manually approved by default.

The existing relay registration was read back: project `fleet`, production,
instance `production`, client `app-f00cf29d-b5ee-44cd-857e-777b3ff5d354`, exact
callback `https://fleet.chrisvouga.dev/auth/callback`, unrevoked, expiring
2027-10-23 at 07:00 UTC. Preserve that identity. Its issuer discovery answered at
`https://auth.chrisvouga.dev/realms/projects`. Applications receive no Google
credential or registration credential. Live Google sign-in remains a separate
acceptance check; discovery is not proof of a completed login.

## Verification and recovery

The deployment workflow verifies the selected image is active, then requires
the read-only volume/writer health probe to pass. The probe checks the actual
mount/name, replica count, active deployment count and startup/shutdown budgets.
Missing credentials/state do not pass deployment. `bun run health --only services`
includes the same probe; `health:fix` supplies an OpenTofu/CI repair pointer.
HTTP `/health` verifies local SQLite/schema readiness, not replica freshness.
Monitor Litestream errors and replication progress separately.

The pinned Railway provider can reset deployment settings during image updates.
The GraphQL settings resource includes the image revision in its operation name,
so OpenTofu reapplies its declared budgets in place after an image update. Its
create operation remains stable to avoid a destructive delete/reset replacement.
A real-provider
regression models that reset between plan and apply and checks the budget is
restored. Do not patch the provider or repair settings through a dashboard.

For rollback, use the supported deployment workflow with `service_id=fleet-api`
and a previously published commit tag. The volume prevents rolling overlap.
Confirm SQLite schema compatibility before selecting an older release; never
force a downgrade or expect the retired PostgreSQL application to read SQLite.
Keep the complete working directory on failure, especially failed final sync.
For replacement-volume recovery, stop the old writer before restoring from the
same prefix and follow a reviewed OpenTofu plan. Do not detach/destroy the live
volume or delete replica objects as a restore test. Replication is asynchronous;
recent unreplicated writes can be lost after hard failure.

Production activation, real-host restart/restore drills, denied-access checks
on the actual host and a completed Google sign-in must be recorded separately.
Do not treat source validation, Moto acceptance, issuer discovery or the offline
owner bootstrap as proof that those production gates passed.
