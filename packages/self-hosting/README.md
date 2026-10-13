# Self-hosted machines

`@pkgs/self-hosting` is the NixOS flake for physical machines we own and run ourselves. CI runners, web servers, an attic cache, and a netboot installer are separate roles composed from `modules/base.nix`. Cloud resources stay in `@pkgs/infra`. Nodes of one role share one closure.

- `hosts/ci.nix`: trusted-code-only GitHub Actions runners (`fleet.nix`).
- `hosts/web.nix`: Caddy in front of one declarative app entry per published OCI image (`web.nix`). Domains and image tags are still TODO.
- `hosts/cache.nix`: attic server. Off until `secrets/cache.yaml` exists. The host and public key are TODO.
- `hosts/netboot.nix`: Pixiecore serving the shared installer, without taking over DHCP.

- [Node and fleet operations](docs/runbook.md): bootstrap, sync, rollback.
- [Manual checklist](docs/checklist.md): firmware, cabling, and where the role key lives.
- [Onboard any project](docs/onboard-project.md): devShell, workflow, cache and hosted fallback.
- [Verified hardware and upstream sources](docs/hardware.md).
- [Agent operating rules](AGENTS.md).
- [Validation status](docs/validation.md).

`fleet.nix` is the CI settings file (the historical name). Shared non-secret values live in `settings/shared.nix`. `profiles/ms-a2.nix` contains the hardware assumptions. The 16-core/32-GiB profile defaults to **4 slots**: `max(1, min(floor(physical cores / 2), floor((RAM GiB - 4) / 6)))`. Slots are distributed round-robin among repository scopes, rather than multiplying capacity per repository. All identical nodes use the same closure and MAC-derived identity. A CI node is `ci-$mac`. A web node is `web-$mac` and does not write `/run/fleet/identity`.

The root is tmpfs. Persistence is the EFI boot partition and `/nix`: store, Nix database/profiles, disposable slot caches, attic data, and `/nix/fleet-state`. Each role has its own age key. Back the keys up outside the fleet. No plaintext secrets are in the flake or ISO.

After bootstrap, nodes pull `deploy`. Canary MACs pull `canary`. They do not pull `main`. The pull agent is `fleet-sync` because comin is not in the pinned nixpkgs. The GitHub Actions workflow that advances those branches runs on `ubuntu-latest`.

Run portable checks with `bun run --filter @pkgs/self-hosting check`. On a Nix-enabled x86_64 Linux builder, `cd packages/self-hosting && just check` builds every host, the installer ISO, and the NixOS VM tests. The lock file is already included. Update pins deliberately with `nix flake update` and repeat validation.

GitHub only loads reusable workflows from `.github/workflows`, so the callable runner entrypoint is [runner-check.yml](../../.github/workflows/runner-check.yml). The fleet gate is [self-hosting.yml](../../.github/workflows/self-hosting.yml), copied from this package. Existing `.github/workflows/ci.yml` stays on GitHub-hosted runners.
