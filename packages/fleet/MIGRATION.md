# Fleet repository extraction

Fleet source now belongs to [crvouga/fleet](https://github.com/crvouga/fleet).
The platform consumes it as the pinned `vendor/fleet` Git submodule. Initialize
it with `git submodule update --init --recursive` after cloning.

## Ownership

- **Fleet repository:** NixOS roles/modules, installer and node tools, management API/UI, schema definition, application tests, standalone builds and release/signing workflows.
- **This platform:** this installation’s machine settings and SOPS files, physical role selection, existing cloud services, DNS, databases, Vault policies/values, GitHub trust, health probes and infrastructure state. Infrastructure remains exclusively OpenTofu-owned.
- **Compatibility:** `packages/fleet` remains a configuration-only flake because installed machines already follow that path in this repository. The pinned upstream code receives the existing settings; the move does not change the pull source, branch, API endpoint, GitHub registration or secret recipients for those machines.

## Updating the dependency

1. Select a Fleet commit whose full CI passed. Review its behavior and schema changes.
2. Advance the `vendor/fleet` gitlink and `packages/fleet/source.json` to that identical commit. Also advance the reusable `runner-check.yml` workflow reference and copy the matching role registry into `packages/fleet/roles.json`. The registry is data for already-installed nodes, whose Git fetch does not initialize submodules. The source-contract test rejects mismatched machine/API pins.
3. Run platform checks and evaluate the compatibility flake on Linux. Review saved OpenTofu plans before any later apply. Do not replace service, database, Vault or schema resources to adopt source ownership.

The API image builds from the submodule’s independent Docker context. It retains
its existing platform image naming and deployment pipeline; standalone Fleet CI
never needs this installation’s credentials. The existing Atlas resource address
is retained and reads the external schema definition. Any future transfer of
schema state must be a separate reviewed state migration, never destroy/recreate.

## Rollout and rollback

This extraction prepares source changes only. It does not apply OpenTofu,
deploy the API, provision signing, publish installer binaries or install/reboot
machines. Merging a platform configuration change can be consumed by the normal
Git pull updater; review the machine configuration evaluation before merging.

Roll back by reverting this platform’s source pin/configuration change and
rebuilding its pinned image through the existing CI pipeline. Do not roll back a
schema revision that requires a data migration without its reviewed reversal.
Never use SSH to bypass Git-managed system changes.

The platform’s enrollment workflow keeps its existing Vault JWT trust and reads
the Vault URL from inventory. Fleet’s own optional enrollment/signing workflows
need separately reviewed trust configuration before activation. Existing Azure
publisher resources and state remain here; they were not moved or re-created.

## Validation

Fleet CI owns portable tests, database/browser integration, native installer
builds and Linux Nix/VM checks. The platform keeps `Check`, `Fleet` and `Required`
status names: `Fleet` verifies pin consistency and evaluates this installation’s
flake when its configuration or source changes. Missing checks and unavailable
live credentials must be reported, never treated as passes.
