# Fleet operations

Git is the control surface. Bootstrap is the one SSH write. After that, a node pulls `deploy` or `canary` by itself. Do not SSH a configuration change onto a node. `just status NODE` only prints the revision, the current system, the sync timer, and failed units.

The human steps that git cannot do are in [checklist.md](checklist.md): firmware, racking, cabling, and the role age key.

Use a Nix-enabled x86_64 Linux work computer or a configured Linux remote builder. A macOS work computer can run bootstrap and orchestrate; it cannot build x86_64 Linux closures or the VM tests without a Linux builder. Install `just`, Nix with `nix-command flakes`, `age`, and `sops`. Work in `packages/fleet`.

## Install one machine

1. Back up anything on the disk. Installation erases it, including Windows. Obtain explicit human approval of that disk. Do not run bootstrap against a machine you have not identified.
2. Do the firmware, cabling, SSH key, and role-key steps in the checklist. Do not write a disk path into the role settings file. Bootstrap prints the internal disk the installer found. USB, removable, hotplug, and mounted disks are skipped. You type that path before anything is erased.
3. For a CI node, choose the GitHub scope in `fleet.nix`. Organizations can share a group across selected private repos; personal accounts must use `scope = "repository"` and `repositories = [ "owner/private-repo" ... ]`. Nothing in this package changes GitHub settings. With human approval, create a GitHub App with organization **Self-hosted runners: write**, or repository **Administration: write**, as required by the [registration API](https://docs.github.com/en/rest/actions/self-hosted-runners). Install it only on intended trusted scopes. Fill the App ID and installation ID. Restrict the group to selected private repositories. Do not switch production workflows yet. Encrypt `secrets/fleet.yaml` for `ci.age` as described in [secrets/README.md](../secrets/README.md), then set `secretsFile`.
4. Web, cache, and netboot each get their own age key and their own encrypted file before `secretsFile` is set. Leave `secretsFile` null until that file exists. Cache and netboot do not import the CI runners.
5. Build from the committed lock:

   ```sh
   just check-local
   just build-iso
   just build-node
   just build-web
   just build-cache
   just build-netboot
   ```

   `just check` and `just vm-test` need an x86_64 Linux builder. The ISO file is `result-iso/iso/fleet-installer.iso`.

6. Flash that ISO once. On Linux, identify the USB with `lsblk` and `udevadm info`, unmount every partition, and pass the exact stable path:

   ```sh
   just flash-usb result-iso/iso/fleet-installer.iso /dev/disk/by-id/usb-EXACT_DEVICE
   ```

   The script shows model, serial, and mounts, requires USB transport, refuses mounted descendants, and requires typing the full path. On macOS the guard refuses to run. Use a reviewed flashing tool, or inspect `diskutil list external physical`, confirm the whole external USB, `diskutil unmountDisk`, and `sudo dd` to the raw device. Recheck the identity immediately before writing.

7. Boot the stick, or PXE-boot from a netboot node that is already installed. The installer only starts SSH. It does not count down and it does not format a disk. Log in with the admin key. The live image has no fleet hostname.
8. From the work computer, with a terminal so the confirmation can be typed:

   ```sh
   just bootstrap ci NODE
   ```

   Replace `ci` with `web`, `cache`, `netboot`, `ci-gpu`, or `ci-canary` (also `web-canary`, `cache-canary`, `netboot-canary`). `NODE` is the installer address. `ci-gpu` and `ci-canary` use the `ci` age key. The command refuses a missing role key, a key inside this repo, two identical role keys, and an empty SSH key list. It builds the shared disko script and that configuration, then nixos-anywhere wipes the disk and copies the age key. The first bootstrap builds locally. Later nodes can substitute from attic once that cache is real.

9. Remove the USB. On the console, read `ssh-keygen -lf /nix/fleet-state/ssh/ssh_host_ed25519_key.pub` and accept that fingerprint. Then `just status NODE`. A CI hostname looks like `ci-a3f9`, `ci-gpu-7c21`, or `ci-highmem-02be`. A web hostname looks like `web-a3f9` and does not write `/run/fleet/identity`.

To install another node of the same role, boot the same USB and run bootstrap again. The DMI UUID supplies the stable id. No per-node Nix file is added. To reinstall, boot the installer and run bootstrap again. That is destructive and needs the same approval. There is no SSH reinstall command.

## What the nodes pull

comin is not in the pinned nixpkgs, so `fleet-sync` is the timer. It is off while `settings/shared.nix` `repo.url` contains `TODO`. Set that URL in a commit. Do not point it at `main`. Until `deploy` exists, a configured node fails the fetch and keeps the generation bootstrap installed. The first `promote-deploy` run creates `deploy`. `canary` is created by the first push to `main` after this workflow is on the default branch.

- A node installed as `ci`, `web`, `cache`, or `netboot` tracks `deploy`.
- A node installed as `ci-canary`, `web-canary`, `cache-canary`, or `netboot-canary` tracks `canary`. That is a track on the same role, not a MAC and not a different disk layout.
- `repo.auth` stays `none` until a read-only deploy key or a GitHub token is encrypted into that role's sops file. Then set `ssh` or `token`. Encrypt the credential separately for each role.

A kernel, initrd, or module change waits up to two hours, seeded by the stable node id, so the fleet does not reboot together. CI nodes then run `fleet-drain` (stop new jobs, wait for the current job, stop the runner units). If the drain fails, the node does not switch and does not reboot. Other changes switch in place. systemd-boot keeps 8 generations. The weekly garbage collection deletes generations older than 14 days.

The running commit is `cat /etc/fleet/revision` and `curl -fsS http://127.0.0.1:9101/metrics` on the node. The metrics port is localhost only.

Failed pulls leave the running generation in place. There is no automatic recovery of a failed boot without a BMC. Keep a console available. The systemd-boot menu still boots an older generation.

## Canary, deploy, and rollback

The workflow is `.github/workflows/fleet.yml`. It runs on GitHub-hosted `ubuntu-latest`, not on this fleet.

- A pull request runs `nix flake check` and builds `ci`, `web`, `cache`, `netboot`, and the installer.
- A push to `main` does that, pushes the four toplevels to attic when `FLEET_CACHE_URL`, `FLEET_CACHE_NAME`, and `FLEET_ATTIC_TOKEN` are set, and fast-forwards `canary`. If those credentials are absent the push is skipped and `canary` still advances. Do not invent the cache URL to make the step pass.
- Watch the canary node. Nothing in GitHub can see its health or its revision, so the soak is not a `sleep` in Actions. 24 hours with no drift and no failed units is the recommendation.
- Run the workflow manually with action `promote-deploy` and `soak_ok` set. That moves `deploy` to the canary commit. It does not rebuild.

A normal rollback is a revert on `main`. It goes through the same pull-request check, canary, soak, and promote steps. The previous generation stays bootable the whole time.

The fast path does not rebuild. Run the workflow manually with action `rollback-deploy` and the full 40-character sha. The sha must already be on `origin/main`. The job force-pushes it to `deploy`. Nodes pull that commit. Systems already in the cache or already on disk are reused. If SSH is gone, pick the previous generation from the systemd-boot menu.

Only the GitHub Actions identity should be allowed to push `deploy` and `canary`. That rule is branch protection in GitHub. This package does not change it.

## CI health

These commands are for a console or a read-only session. They are not a second deploy path.

```sh
systemctl --failed
systemctl status 'github-runner-*'
journalctl -u github-runner-slot-1 -b
journalctl -u fleet-sync -u fleet-cache-clean -b
journalctl -u sops-install-secrets -u node-identity -b
journalctl -k -b | grep -Ei 'watchdog|nvme|i40e|igc|r8169|error'
readlink /run/current-system
cat /etc/fleet/revision
df -h / /nix /boot
du -sh /nix/ci-cache/*
systemctl list-timers
ls -l /dev/watchdog*
cat /sys/class/watchdog/watchdog*/identity
systemctl show -p RuntimeWatchdogUSec
```

Workflows that target this fleet must require `nixos` and `ci`. Jobs that ask only for `self-hosted` evade the label drain. A job already dispatched when the barrier appears may fail its start hook; retry it on another node. `fleet-drain` is what the sync script runs before a CI reboot. Do not invent a second drain.

The manager requests a 30-second hardware watchdog and a panic reboot. Recovery from a hard hang needs a supported hardware watchdog. `softdog` is not that proof. MS-A2 watchdog availability is verified on the machine. Nix GC runs weekly. Hourly CI cache cleanup enforces a 100 GiB soft ceiling and a 30 GiB free-space floor. Active runner caches are not deleted. A large active job can still fill the disk.

After a RAM or CPU change, reboot. The slot count and the high-mem label are detected at boot. Do not edit a per-machine file. A 16-core 32 GiB machine stays at 4 slots. At 96 GiB the same formula allows 8, which is the cap. A machine that needs different software gets a capability module, not a host file.

To remove a node, wait until it is not running a job, power it off, and delete the offline GitHub registration through an approved admin action. Do not delete a busy runner.

## Caches

Two caches exist and they are not the same:

- The fleet attic cache is `settings.binaryCache` plus the cache role. Clients use it only after the URL and the public key are real and do not contain `TODO`. The server listens on port 8080 and stores data under `/nix/fleet-state/attic`. It stays disabled until `secrets/cache.yaml` provides `attic-env`.
- `cache.remote` in `fleet.nix` is an optional S3 scratch substituter and post-build hook for CI. Leave it off. Do not enable it while `binaryCache.url` is set; both would write `extra-substituters`. Bucket provisioning stays in OpenTofu.

Runner users must never receive the App key, a signing key, or the attic token. Projects can use their own scoped build-cache credentials. Nix signatures do not validate arbitrary project cache objects.
