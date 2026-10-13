NixOS configurations for physical machines we own and run ourselves: CI runners, web servers, a binary cache, a netboot installer, and later GPU and dev boxes. Nothing here provisions cloud resources; cloud infrastructure lives in `../infra`.

Git is the only control surface after bootstrap. Do not SSH a change onto a node. `just status NODE` is read-only. `just bootstrap ROLE IP` is the only SSH write, and it wipes the disk.

`modules/base.nix` is the only module shared by every role: users, SSH, the sops age-key path, store maintenance, watchdog, the shared disk layout, pull sync, boot identity, and the revision endpoint. Do not put role switches in `base.nix`. `hosts/` composes a role plus capability modules. It never names a machine.

Roles:

- `ci`: `hosts/ci.nix`, `fleet.nix`, `modules/ci-runner.nix`. The GitHub App key, runner users, slot cache, and `secrets/fleet.yaml` stay here. CI runs untrusted pull-request code.
- `web`: `hosts/web.nix`, `web.nix`, `modules/web-server.nix`. Apps are OCI images behind Caddy, with `secrets/web.yaml`.
- `cache`: `hosts/cache.nix`, `cache.nix`, `modules/cache-server.nix`. This is the attic binary cache. It is not the optional CI scratch substituter in `modules/cache.nix`.
- `netboot`: `hosts/netboot.nix`, `netboot.nix`, `modules/netboot.nix`. Pixiecore serves the shared installer. `dhcpNoBind` stays true unless this host is the DHCP server for that network.

CI and web must never share an age key or a secrets file. Cache and netboot use their own keys and files too. Bootstrap refuses two role keys that compare equal.

To add a role, add `modules/<role>.nix` with only that role's services, add `hosts/<role>.nix` that imports `base.nix` and that module, and add a settings file plus a `nixosSystem` in `flake.nix`. Set `reboot.drainCommand` only when the role must drain before a kernel reboot. Every role uses `modules/disks/internal.nix`.

To add a machine of an existing role, boot the installer and run bootstrap for that role. Do not add a host file, a profile, or a hand-picked name.

## Cattle, not pets

Any node is replaceable by any other box with the same role and capabilities. Configurations exist only per role (`ci`, `web`, `cache`, `netboot`), optionally combined with a capability that changes the software (`hosts/ci-gpu.nix`). `hosts/` filenames must be the role plus capabilities from that set. `ci-canary` is a track, not a host file.

Never add per-machine configuration or a hand-picked name. No `hardware-configuration.nix`, no disk serial, no `/dev/sdX` or `/dev/nvmeN`, no interface name, no MAC, and no static `networking.hostName`. If a machine seems to need special treatment, add a capability module or fix `modules/hardware/generic.nix`. `scripts/cattle.py check` and `nix flake check` fail the build when those show up in a Nix file.

The generic profile boots a reasonable x86_64 UEFI machine: broad initrd modules, both Intel and AMD microcode, redistributable firmware, and DHCP on every wired Ethernet device by type. aarch64 is a later architecture variant of these same roles, not a board file. The kernel is the NixOS default.

Disko installs the sentinel `/dev/self-hosting-install-disk`. Bootstrap asks the installer to pick the first internal NVMe, then the first SATA disk, skipping USB, removable, hotplug, and anything mounted. The operator types that discovered path. Filesystems are labeled `SHBOOT` and `sh-nix` and mounted by label.

### Hostnames

A hostname is `<role>[-gpu][-highmem]-<4 hex>` and is set at boot, not in the Nix config. Examples: `ci-a3f9`, `ci-gpu-7c21`, `ci-highmem-02be`, `ci-gpu-highmem-7c21`, `web-a3f9`. The id is the first 4 hex digits of sha256 of the DMI system UUID, or of the lowest permanent MAC when the UUID is missing. Four digits can collide; the UUID makes that unlikely, and a reinstall of the same box keeps the name. The transient name is applied before SSH, metrics, and runner registration. `/etc/hostname` stays absent. The installer image has no fleet hostname.

GPU is a software capability: `environment.etc."self-hosting/capabilities.d/gpu"` exists only in the `ci-gpu` closure. high-mem is not a closure. It is MemTotal strictly above `capacity.highMemGiB` (60) times 1024, so a 64 GiB box qualifies and a 32 GiB box does not. The hostname tag is `highmem`. The runner label is `high-mem`.

To add a capability that changes software, add `modules/capabilities/<name>.nix`, import it from `hosts/<role>-<name>.nix`, and allow that extra stem in `HOST_CAPABILITIES` inside `scripts/cattle.py`. Write one tag per line under `environment.etc."self-hosting/capabilities.d/<name>"` and list it in `TAG_ORDER` when the hostname should include it. A legacy GPU driver is another module, still not a machine. A fact that does not change the closure, such as high-mem, is a threshold in `capacity` and is not a host file.

### Capacity and labels

CI runner count is computed at boot in `scripts/cattle.py`, from `settings/shared.nix` `capacity`: `min(slotMax, max(1, min(cores / perRunnerCores, (MemTotal MiB - reserveGiB * 1024) / (perRunnerGiB * 1024))))` with integer division. Production constants are 4 GiB reserved, 6 GiB and 2 cores per runner, and at most 8. A 16-core 32 GiB machine stays at 4 slots. The closure contains units `slot-1` through `slotMax`; only the live count is started. Workflows target `self-hosted`, `nixos`, and `ci`, plus `gpu` or `high-mem` when they need that capability. They do not target a machine or a model name. `nix build .#nixosConfigurations.ci-gpu` is opt-in. The default CI build does not download the unfree driver.

`http://127.0.0.1:9101/metrics` reports `nixos_node_info` with hostname, role, capabilities, and revision. It is localhost only.

To add an app on the web role, append one attrset to `apps` in `web.nix`: `name`, `domain`, `port`, `containerPort`, and `image` (the OCI image CI already publishes). Set `envSecret` only together with this role's encrypted `secrets/web.yaml`. A null `image` is the local placeholder used until those values are real. Do not invent a domain or an image tag.

## Bootstrap

The installer is generic. `just build-iso` produces `self-hosting-installer.iso`: SSH, DHCP, and the admin public keys from `settings/shared.nix`. It does not partition a disk or embed a role. One USB is used for every box. The netboot role serves that same installer over PXE.

`nix run .#bootstrap -- <role> <ip>` (or `just bootstrap ROLE IP`) wraps nixos-anywhere. The target must already be booted into this installer, which has `select-disk` on `PATH`. The role is `ci`, `web`, `cache`, `netboot`, `ci-gpu`, or `<role>-canary`. The age key is the role prefix: `ci-gpu` and `ci-canary` both use `ci.age`, from `$HOME/.config/self-hosting/keys/<role>.age` or `$SELF_HOSTING_KEY_DIR/<role>.age`. Generate it with `age-keygen`. This package does not generate keys. The key must not live inside the git checkout. Bootstrap copies it with `--extra-files` to `/nix/fleet-state/secrets/age.key` on the persistent `/nix` partition. The operator types the disk path the installer discovered. An empty `sshKeys` list or a missing key refuses to run. The first install builds on the operator machine because the attic cache does not exist yet.

The ISO host key is ephemeral. The installed host key is `/nix/fleet-state/ssh/ssh_host_ed25519_key`. Read its fingerprint on the console before accepting it. Steps that stay outside git are in `docs/checklist.md`.

## Sync and rollback

comin is not in nixpkgs at the pinned revision `7c8764b7`, and this flake does not add an unlocked input. `modules/sync.nix` and `scripts/fleet-sync.sh` are the pull agent. Do not also enable `system.autoUpgrade`.

A closure with `track = "deploy"` pulls `deploy`. `ci-canary` (and the other `*-canary` configurations) pull `canary`. Nothing tracks `main`. The timer stays off while `repo.url` contains `TODO`. The poll is 300 seconds plus 30 seconds of jitter. `self.rev` is null on a dirty tree; the revision is `self.rev`, then `self.dirtyRev`, then `unknown`. It is published at `/etc/self-hosting/revision` and `http://127.0.0.1:9101/metrics` (localhost only).

A kernel, initrd, or module change sleeps for `cksum(stable id) % delayMaxSeconds` (default 7200; 0 disables). The id is read only when a reboot is required. If that read fails, the node does not reboot. On CI that sleep is followed by `fleet-drain`, then `switch-to-configuration boot` and reboot. A failed drain does not switch or reboot. Other changes switch in place and do not drain. systemd-boot keeps `bootGenerationLimit` generations (8). Weekly garbage collection deletes generations older than 14 days.

Git read access is `repo.auth`: `none`, `ssh` (`/run/secrets/git-read-key`), or `token` (`/run/secrets/git-read-token`). Encrypt that credential separately into each role's sops file. Any auth other than `none` requires that role's `secretsFile`.

The fleet binary cache is attic. Clients add it as a substituter only when `binaryCache.url` and `binaryCache.publicKey` are both set and neither contains `TODO`. Leave both null until they are real. Do not enable it together with `cache.remote`. Attic storage is bind-mounted from `/nix/fleet-state/attic` because the root is tmpfs. The cache role stays off while its `secretsFile` is null, so a build does not mint a JWT.

`.github/workflows/self-hosting.yml` is a byte copy of `workflows/self-hosting.yml`. It runs on `ubuntu-latest`, never on this fleet, so a broken fleet can still be fixed by pushing a commit. Pull requests run `nix flake check` and build every host. A push to main does that, pushes the four toplevels to attic when the cache variables and token exist, and fast-forwards `canary`. Missing cache credentials skip the push and still advance `canary`.

Nothing reports drift or health back to GitHub, so the soak is a manual `workflow_dispatch`. After the canary looks healthy (24 hours is the recommendation), run the workflow with action `promote-deploy` and `soak_ok` true. That moves `deploy` to `canary` and does not rebuild.

A rollback is a git revert on main, which flows through the same pipeline. The fast path is `workflow_dispatch` action `rollback-deploy` with a 40-character sha that is already on `origin/main`. It force-pushes that sha to `deploy` and does not rebuild. The previous systemd-boot generation stays selectable from the console.

Branch protection is a GitHub setting this package does not apply: only the GitHub Actions identity may push `deploy` and `canary`.

This package does not own GitHub configuration, buckets, billing, DNS, or other workspace infrastructure. Every dependency is pinned in `flake.lock`. Do not update it implicitly. Do not commit tokens, age private keys, or plaintext secrets.

Run `bun run --filter @pkgs/self-hosting check` for portable checks. From this package: `just check`, `build-node`, `build-web`, `build-cache`, `build-netboot`, `build-iso`, `vm-test`, `flash-usb ISO DEVICE`, `bootstrap ROLE IP`, and `status NODE`.

`flash-usb` and `bootstrap` are destructive. Obtain explicit human approval identifying the disk before executing them. An interactive confirmation is an additional check, never authorization. Do not execute a generated installer or a VM against physical disks. Never print secrets, place them in CLI arguments, or copy plaintext credentials into the Nix store. Never change GitHub settings, secrets, or billing without explicit approval. Runtime registration uses the configured GitHub App; tokens remain in `/run`.

CI nodes drain through `scripts/drain.sh` (`fleet-drain`) before a kernel reboot. Restrict runner projects to private trusted code, require `nixos` and `ci` routing labels, and never run fork PRs or `pull_request_target` on the runner fleet. Keep credentials root-only. Inspect actual upstream module source at the locked nixpkgs revision when changing module behavior. A local portable check is not `nix flake check` and is not a VM test. Report when those were not run.
