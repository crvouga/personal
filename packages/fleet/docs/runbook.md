# Fleet operations

Git is the control surface. After bootstrap, SSH is read-only emergency access. No changes are ever made over SSH. `just status NODE` prints the revision, the current system, the sync timer, failed units, the last health-check rollback, and the disk sample.

The human steps that git cannot do are physical: hardware replacement, cleaning, and one-time BIOS setup. They are listed in [checklist.md](checklist.md). Anything else that seems to need a person at a running node is a bug. Fix it in code.

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

   Replace `ci` with `web`, `cache`, `netboot`, or `ci-gpu`. `NODE` is the installer address. `ci-gpu` uses the `ci` age key. The command refuses a missing role key, a key inside this repo, two identical role keys, and an empty SSH key list. It builds the shared disko script and that configuration, then nixos-anywhere wipes the disk and copies the age key. The first bootstrap builds locally. Later nodes can substitute from attic once that cache is real.

9. Remove the USB. On the console, read `ssh-keygen -lf /nix/fleet-state/ssh/ssh_host_ed25519_key.pub` and accept that fingerprint. Then `just status NODE`. A CI hostname looks like `ci-a3f9`, `ci-gpu-7c21`, or `ci-highmem-02be`. A web hostname looks like `web-a3f9` and does not write `/run/fleet/identity`.

To install another node of the same role, boot the same USB and run bootstrap again. The DMI UUID supplies the stable id. No per-node Nix file is added.

## Reinstall from the netboot server

One-time BIOS setup puts the network first and the internal disk second. On every boot the netboot server is asked what to do. With `reinstall.nodes` and `reinstall.roles` both empty, the client boots the local disk (`exit 1` back to firmware, or `sanboot` on BIOS).

To reinstall one node, add its 4-hex stable id to `reinstall.nodes` in `settings/shared.nix` and merge. The id is the same value `cattle.py` prints: the first 4 hex digits of sha256 of `dmi:` plus the SMBIOS UUID. To reinstall every node of a role, add `ci`, `web`, `cache`, or `netboot` to `reinstall.roles`. `ci-gpu` is role `ci`. The installed system writes that role to `/boot/fleet-role.ipxe` on the ESP volume `SHBOOT`. The iPXE script reads it. A machine with no ESP file is selected only by its stable id.

The netboot host pulls the same commit and starts serving the installer to the flagged client. Power-cycle that machine so firmware hits the network. Bootstrap from the installer as usual, then clear the flag in a follow-up commit. Leaving a role flagged serves the installer to every client of that role that netboots.

TODO: no smart PDU model is selected, and this repo does not call one. A remote power cycle is physical until a model and its integration are added in code. Do not invent a vendor, a host, or a credential. There is no SSH reinstall command.

## What the nodes pull

comin is not in the pinned nixpkgs, so `fleet-sync` is the timer. It is off while `settings/shared.nix` `repo.url` contains `TODO`. Set that URL in a commit. Every role polls `main` over HTTPS. There is no `deploy` branch and no `canary` branch.

The node switches only when `nix build --max-jobs 0` can substitute that role's toplevel from the attic cache. A miss keeps the running generation and the timer retries. The node does not build locally. While `binaryCache.url` or `binaryCache.publicKey` is null or contains `TODO`, the node waits the same way. `repo.auth` stays `none` until a read-only deploy key or a GitHub token is encrypted into that role's sops file. Then set `ssh` or `token`. Encrypt the credential separately for each role.

A kernel, initrd, or module change drains first, then waits up to two hours, seeded by the stable node id, so the fleet does not reboot together. The id is read before the drain. If that read fails, the node does not drain and does not reboot. CI nodes run `fleet-drain` (stop new jobs, wait for the current job, stop the runner units). If the drain fails, the node does not switch and does not reboot. Other changes switch in place.

After the switch, the node checks GitHub, the cache's `nix-cache-info`, and that `fleet-sync` still loads and its timer is not failed. A failure restores the previous generation, skips the reboot, and records `/run/fleet/health-failure`. The unit goes failed. TODO: nothing ships that file off the node. `monitoring.pushUrl` is unused. Do not invent a collector.

systemd-boot keeps 8 generations and waits 5 seconds. The newest entry is named with 3 tries left. A generation that never finishes booting falls through to the previous one. `systemd-bless-boot` clears the count when userspace comes up. The weekly garbage collection deletes store paths older than 14 days. The journal is volatile and capped, because the root is tmpfs. `fleet-disk` fails at 90% full on `/nix` or `/boot`. That failure is also local until a collector exists.

The running commit is `cat /etc/fleet/revision` and `curl -fsS http://127.0.0.1:9101/metrics` on the node. The metrics port is localhost only. `systemctl status fleet-drift` fails when this node is still off `origin/main` more than `drift.maxMinutes` (30) after that commit. A newer merge is inside the grace window. TODO: a node that stops reporting at all is not visible from outside, because nothing scrapes `127.0.0.1:9101`. The health report's `fleet revision` check stays `SKIP` until a scraper exists. That check is not OpenTofu plan drift.

A failed pull leaves the running generation in place. A switch that cannot reach GitHub or the cache rolls back by itself. A generation that does not boot falls back to the previous entry. The hardware watchdog reboots a hung userspace. The menu is still there for 5 seconds. TODO: a machine that ignores both the watchdog and the network still needs a person or a PDU, and no PDU is integrated.

## Checks, the merge queue, and rollback

The workflow is `.github/workflows/fleet.yml`. It runs on GitHub-hosted `ubuntu-latest`, not on this fleet. One path changes a node: pull request, required checks, merge queue, `main`, nodes pull.

- A pull request that touches this package runs `nix flake check` and builds `ci`, `web`, `cache`, `netboot`, and the installer. `ci-gpu` is not in that build.
- The `Fleet` check reports on every pull request. A diff outside this package succeeds without building, so the queue is not stuck on a skipped workflow.
- The merge queue repeats the check and pushes the four toplevels to attic before the commit reaches `main`. Missing `FLEET_CACHE_URL`, `FLEET_CACHE_NAME`, or `FLEET_ATTIC_TOKEN` fails the queue. Do not invent the cache URL.
- The queue merges with `MERGE`. The commit that was tested and cached is the commit that lands. There is no second cache push after merge.

A rollback is a revert pull request. It uses the same checks and the same queue. The previous systems are already in the cache, so nodes converge by substituting. systemd-boot keeps 8 generations. If SSH is gone, pick an older generation from the console. Nothing force-pushes `main`.

The `main` ruleset (pull request, `Required`, `Fleet`, merge queue, no force-push) is declared in OpenTofu. This package does not apply it. Apply a reviewed plan from `packages/infra`.

Once a week, `.github/workflows/flake-update.yml` opens or updates one pull request that only changes `packages/fleet/flake.lock`. That pull request uses this same path. It does not push `main`.

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

The manager requests a 30-second hardware watchdog and a panic reboot. Recovery from a hard hang needs a supported hardware watchdog. `softdog` is not that proof. Watchdog availability is verified on the machine. Nix GC runs weekly and deletes paths older than 14 days. `fleet-disk` fails the unit at 90% on `/nix` or `/boot`. Hourly CI cache cleanup enforces a 100 GiB soft ceiling and a 30 GiB free-space floor. Active runner caches are not deleted. A large active job can still fill the disk. The journal rotates by a 256M cap. TODO: logs and metrics are not shipped off-node.

After a RAM or CPU change, reboot. The slot count and the high-mem label are detected at boot. Do not edit a per-machine file. A 16-core 32 GiB machine stays at 4 slots. At 96 GiB the same formula allows 8, which is the cap. A machine that needs different software gets a capability module, not a host file.

To remove a node, wait until it is not running a job, power it off, and delete the offline GitHub registration through an approved admin action. Do not delete a busy runner. Role age-key rotation is two commits, described in [secrets/README.md](../secrets/README.md). Do not SSH a new key onto a running node.

A pull request that touches this package runs `nix flake check`, which includes the `follow-up` VM test. That test is required. It does not add a new GitHub status name. The `Fleet` check is the one the ruleset names.

## Caches

Two caches exist and they are not the same:

- The fleet attic cache is `settings.binaryCache` plus the cache role. Clients use it only after the URL and the public key are real and do not contain `TODO`. The server listens on port 8080 and stores data under `/nix/fleet-state/attic`. It stays disabled until `secrets/cache.yaml` provides `attic-env`.
- `cache.remote` in `fleet.nix` is an optional S3 scratch substituter and post-build hook for CI. Leave it off. Do not enable it while `binaryCache.url` is set; both would write `extra-substituters`. Bucket provisioning stays in OpenTofu.

Runner users must never receive the App key, a signing key, or the attic token. Projects can use their own scoped build-cache credentials. Nix signatures do not validate arbitrary project cache objects.
