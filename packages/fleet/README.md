# Fleet

`@pkgs/fleet` is the NixOS flake for physical machines we own and run ourselves. CI runners, web servers, an attic cache, a netboot installer, and remote devboxes are separate roles composed from `modules/base.nix`. Cloud resources stay in `@pkgs/infra`. Nodes of one role share one closure.

- `hosts/ci.nix`: trusted-code-only GitHub Actions runners (`fleet.nix`).
- `hosts/web.nix`: Caddy in front of one declarative app entry per published OCI image (`web.nix`). Domains and image tags are still TODO.
- `hosts/cache.nix`: attic server. Off until `secrets/cache.yaml` exists. The host and public key are TODO.
- `hosts/netboot.nix`: Pixiecore. Clients boot the local disk. A reinstall flag does not install a node, because this host does not serve an image that can finish an install. It does not take over DHCP.

- [Node and fleet operations](docs/runbook.md): bootstrap, sync, rollback.
- [Manual checklist](docs/checklist.md): firmware, cabling, and the one-file install.
- [Onboard any project](docs/onboard-project.md): devShell, workflow, cache and hosted fallback.
- [Verified hardware and upstream sources](docs/hardware.md).
- [Agent operating rules](AGENTS.md).
- [Validation status](docs/validation.md).

`fleet.nix` is the CI settings file (the historical name). Shared non-secret values live in `settings/shared.nix`. Hardware is `modules/hardware/generic.nix`, not a model profile. Runner slots are counted at boot: reserve 4 GiB, then one slot per 2 cores and 6 GiB, at most 8. A 16-core 32 GiB machine still gets **4 slots**. Slots are distributed round-robin among repository scopes, rather than multiplying capacity per repository. A hostname is `<role>[-gpu][-highmem]-<4 hex>`, for example `ci-a3f9` or `ci-highmem-02be`. A web node does not write `/run/fleet/identity`.

The root is tmpfs. Persistence is the EFI boot partition and `/nix`: store, Nix database/profiles, disposable slot caches, attic data, and `/nix/fleet-state`. Each role has its own age key, created on the first node of that role. The public key is printed on the console. A `FLEET-KEY` volume carries the private key to the next node of the same role. No plaintext secrets are in the flake or ISO.

After bootstrap, every node polls `main` and switches only when its system is already in the binary cache. The pull agent is `fleet-sync` because comin is not in the pinned nixpkgs. The node does not build locally.

`just` and the other system tools are pinned in the repo-root `mise.toml`. Run `mise install` once. Portable checks are `bun run --filter @pkgs/fleet check`. On a Nix-enabled x86_64 Linux builder, `cd packages/fleet && just check` builds every host, the installer ISO, and the NixOS VM tests. The lock file is already included. Update pins deliberately with `nix flake update` and repeat validation.

GitHub only loads reusable workflows from `.github/workflows`, so the callable runner entrypoint is [runner-check.yml](../../.github/workflows/runner-check.yml). The fleet gate is [fleet.yml](../../.github/workflows/fleet.yml), copied from this package. It runs on GitHub-hosted runners. `ci.yml` stays there too. The merge queue fills the binary cache before a fleet commit reaches `main`.

For a graphical install, download a platform app from the `fleet-installer` release and follow [the wizard guide](docs/installer.md). Remote devboxes use the `dev` SSH account and retain project files under `/nix/devbox` across reboots; converting roles erases those files.
