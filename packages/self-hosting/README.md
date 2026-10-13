# Self-hosted machines

`@pkgs/self-hosting` is the NixOS flake for physical machines we own and run ourselves. CI runners and web servers are separate roles composed from `modules/base.nix`. Cloud resources stay in `@pkgs/infra`. Nodes of one role share one closure.

- `hosts/ci.nix`: trusted-code-only GitHub Actions runners (`fleet.nix`).
- `hosts/web.nix`: Caddy in front of one declarative app entry per published OCI image (`web.nix`). Domains and image tags are still TODO.

- [Node and fleet operations](docs/runbook.md): node #1, secrets, deployment, recovery, scaling.
- [Onboard any project](docs/onboard-project.md): devShell, workflow, cache and hosted fallback.
- [Verified hardware and upstream sources](docs/hardware.md).
- [Agent operating rules](AGENTS.md).
- [Validation status](docs/validation.md).

`fleet.nix` contains shared non-secret settings; `profiles/ms-a2.nix` contains hardware assumptions. The 16-core/32-GiB profile defaults to **4 slots**: `max(1, min(floor(physical cores / 2), floor((RAM GiB - 4) / 6)))`. Slots are distributed round-robin among repository scopes, rather than multiplying capacity per repository. All identical nodes use the same closure and MAC-derived identity.

The root is tmpfs. Persistence is limited to the EFI boot partition and `/nix`: store, Nix database/profiles, disposable slot caches, and the explicit `/nix/fleet-state` credential/SSH allowlist. A shared fleet age key and SSH identity are necessary operational state; back up the key outside the fleet. No plaintext secrets are in the flake or ISO.

Run portable checks with `bun run --filter @pkgs/self-hosting check`. On a Nix-enabled x86_64 Linux builder, `cd packages/self-hosting && just check` builds the CI and web systems, the CI installer, and both mocked NixOS VM tests. The lock file is already included; do not generate an unpinned lock as a bring-up step. Update pins deliberately with `nix flake update` and repeat validation.

GitHub only loads reusable workflows from `.github/workflows`, so the callable entrypoint is [runner-check.yml](../../.github/workflows/runner-check.yml); project examples remain inside this package. Existing `.github/workflows/ci.yml` remains on GitHub-hosted runners because it currently uses Ubuntu/Playwright `--with-deps`, Docker, and OpenTofu deployment jobs.
