# Dormant Turborepo remote cache

Remote caching is disabled in the root `turbo.json`. This package retains the
server, Dockerfile, unit tests and manual tooling for future reference, but is
absent from the hosting inventory, automatic image publication, deployment
smoke tests and normal `bun run dev`. `dev:dormant` is an explicit manual launch.
The historical setup prompt must not be used to register new clients.

OpenTofu retires the dedicated Railway service and its variable collection and
removes Turbo client credentials from both Vault scopes, including stale values
from older secrets exports. Clients should remove `TURBO_API`, `TURBO_TOKEN` and
`TURBO_TEAM`, use `TURBO_CACHE=local:rw`, and set `remoteCache.enabled` to `false`.
GitHub Actions still persists local `.turbo` artifacts.

Fleet's Nix cache is retired as well. Its historical routes and publication
scripts stay here as dormant code. The dedicated service, public hostname,
Vault publisher credentials, publication workflow and release dependency are
removed. Fleet builds closures locally with upstream Nix substitutes and validates
bundled installer closures before disk changes. Shared R2 buckets and their contents remain owned by other applications.

Production deprovisioning requires the authenticated deployment workflow to
review and apply encrypted saved plans. Local validation does not remove live
resources. Verify the dedicated Railway service and DNS records are gone after
applying the fleet root and that the Vault publisher roles are removed.
