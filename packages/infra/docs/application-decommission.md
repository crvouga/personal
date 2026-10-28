# Application decommissioning

Fleet code, the machine configuration package, source submodule, enrollment and runner workflows, image publication, health checks, auth-setup integration and service inventory entry have been removed. The standalone project owns its implementation. This platform retains only declarative retirement records and the compatibility names needed for existing shared state and branch protection.

No live infrastructure or machines have been changed by this work. Do not merge into an automatically deploying main branch until the destructive changes below have been reviewed. Local validation and mocked-provider tests cannot establish the contents of live encrypted state or prove that production retirement succeeded.

## Preserve shared state and unrelated applications

The generic hosting root has moved from `tofu/fleet` to `tofu/services`. Its backend must continue to use **`fleet.tfstate`** in the existing encrypted, locked R2 backend. CI explicitly maps the new directory to that key. Existing local operators must move their ignored backend configuration to the new directory, preserve its key, and reinitialize against the same backend. Do not initialize an empty `services.tfstate`, migrate state by deleting it, or import duplicate services.

All unrelated service module addresses, variables, image revisions and generic hosting behavior remain unchanged. `services/retired-application.tf` moves only `module.service["fleet-api"]` to an isolated retired module before destroying it. This preserves the shared module's `prevent_destroy` guard for active applications, following the existing cache-retirement pattern. Review that the plan destroys only the retired API service, its custom domain, variables, settings and dedicated DNS records. Take the application offline before retiring credentials or data.

## Review and apply retirement separately

1. Pause automatic deployments during the retirement window. Back up the encrypted states, the isolated application's database data and any operational configuration needed to recover. Check whether physical machines still send heartbeats, enroll or pull updater configuration from this platform; move or retire them through their owning project before removing access. This repository no longer manages those machines.
2. Initialize the `services` root against `fleet.tfstate`, preserve the complete deployed `image_tags` output and review an encrypted saved plan with Railway operations serialized (`-parallelism=1`). Confirm every unrelated service is unchanged. Apply only that reviewed saved plan after approval.
3. Review the Vault saved plan. It retires the generated Fleet admin/session/role passwords, per-role `secret/fleet/<role>` documents, and enrollment policy/JWT role. The shared personal dev/prd documents and authentication mounts remain protected. Only `FLEET_ADMIN_TOKEN`, `FLEET_SESSION_SECRET` and `FLEET_ROLE_TOKEN_HASHES` are removed from older secret exports; all unrelated inputs remain. Existing legacy `fleet_age_keys` metadata in saved deployment inputs is no longer forwarded to the Vault root. Do not discard unrelated input maps when cleaning that metadata.
4. Review the foundation saved plan and the provider's actual schema deletion behavior. Retirement addresses are only `atlas_schema.fleet` and `postgresql_schema.fleet`; never run a root-wide destroy, unscoped Atlas command or database drop. Confirm the isolated schema's tables are backed up and can be removed in dependency order. If the PostgreSQL provider refuses a nonempty schema, stop: prepare and review a scoped OpenTofu schema-retirement change in the owning application. Do not use manual SQL, enable broad cascades or touch `secret_store`, authentication schemas or the shared PlanetScale branch/role.
5. The `signing` root is now retirement-only. Initialize it against its existing **`signing.tfstate`**, with the original Azure tenant/subscription and GitHub owner supplied as `TF_VAR_tenant_id`, `TF_VAR_subscription_id` and `TF_VAR_github_owner`. Authenticate the providers and review an encrypted saved plan. It removes the dedicated signing account/profile, publisher identity/federation, role assignments, resource group and Actions variable. Confirm the group contains no unrelated resources before approving deletion. Subscription-wide Azure provider registrations use `destroy = false`: they leave this root's state without unregistering APIs that other workloads may need. Keep the root, provider locks and encrypted state until completion is verified.
6. Read back the live service, DNS, Vault and signing state after their reviewed applies. Verify unrelated public services, auth and secret access. Resolve provider permissions, missing backups or remaining dependencies before claiming decommissioning is complete. No live plan or apply has been run for this PR.

## Required-status migration

The desired GitHub ruleset now requires only `Check`. The existing live ruleset may still require `Fleet` or `Required`. CI keeps both legacy aliases reporting the actual platform validation result, so this PR remains mergeable without weakening validation or referencing external code. Apply the reviewed foundation ruleset change, read back the live rules, and verify a successful PR run before removing those two aliases and their tests/documentation in a follow-up. Their names and the old shared backend key are compatibility artifacts, not runtime dependencies on the standalone project.

Retirement resource addresses and stale-key exclusion lists must remain until live state and deployment inputs are confirmed clean. Removing those records earlier would hide the migration intent; renaming state keys or deleting shared documents would affect unrelated behavior.

## Fleet domain retirement recovery

Deploy run `40605539666` deleted the Fleet service and dedicated DNS records on
its first attempt, then failed deleting custom domain
`22efd584-cecb-4da6-a362-e7a8898edfb7` because Railway reported an operation in
progress. The second attempt confirmed that Railway had removed the domain:
the pinned provider failed its refresh with `Unable to find custom domain`.

`services/retired-application.tf` moves only that stale domain address outside
the retired module and removes it with `destroy = false`. The shared CI OpenTofu
action first applies a targeted, refresh-disabled recovery plan, guarded to allow
only forgetting that exact domain ID. This is necessary because OpenTofu still
refreshes removed resources by default. Once the address leaves state, recovery
is skipped. The ordinary full deployment plan retains refresh. The module-wide retirement still
destroys any other remaining Fleet resources. This recovery does not forget
the service module or any active application's resources. Apply it through the
normal reviewed saved-plan deployment; its presence alone does not establish
that the recovery has been applied.
