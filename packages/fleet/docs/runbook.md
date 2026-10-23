# Fleet operations

Git is the control surface. After bootstrap, SSH is read-only emergency access. No changes are ever made over SSH. `just status NODE` prints the revision, the current system, the sync timer, failed units, the last health-check rollback, and the disk sample.

The human steps that git cannot do are physical: hardware replacement, cleaning, and one-time BIOS setup. They are listed in [checklist.md](checklist.md). Anything else that seems to need a person at a running node is a bug. Fix it in code.

Adding a node does not need Nix, a git checkout, `just`, `gh`, or a second computer. `just check` and `just vm-test` still need an x86_64 Linux builder. Work in `packages/fleet`.

## Install one machine

A person who would rather click than type: [installer.md](installer.md) is the downloadable wizard (Windows, macOS, Linux). What follows is the command line the wizard is built on.

The machine can already be running Windows, macOS, or Linux. Download one file onto that machine and run it. On Windows the wizard shrinks `C:`, writes the installer into the freed space and schedules one boot into it; on Linux it uses `kexec`; macOS makes a USB stick. The same command is the reinstall. A machine with no operating system cannot download; write the installer to a USB disk with `bash fleet-node.sh flash` from a computer that has one, then boot that disk.

1. Do the firmware and cabling steps in the checklist. Do not write a disk path, a MAC, or a name into git. The lasting boot order is network, then the internal disk.
2. On the machine, download the node program and run it. The release does not expire. The 14-day `fleet-installer` Actions artifact is not this download.

   ```sh
   curl -fsSL -o fleet-node.sh https://github.com/crvouga/workspace/releases/download/fleet-installer/fleet-node.sh
   bash fleet-node.sh
   ```

   Windows, from PowerShell: `curl.exe -fsSL -o fleet-node.sh https://github.com/crvouga/workspace/releases/download/fleet-installer/fleet-node.sh` and then `bash fleet-node.sh`. `bash fleet-node.sh ci --yes` (or `web`, `cache`, `netboot`, `devbox`) runs with no prompts; `--yes` skips only the typed confirmation and every disk refusal still applies. Without it, the program asks for `ci`, `web`, `cache`, `netboot`, or `devbox`. It names that role and the internal disk in plain language. Nothing is erased until you type the line it shows. A timeout, an empty answer, a wrong line, or a USB, removable, hotplug, or ambiguous disk leaves every disk unchanged and prints one next step. If the download fails, the program exits non-zero, writes nothing, and prints one next step. `ci-gpu` is not on this image.

   Or hand it to an agent on the machine: tell it `Set this machine up as a fleet <role> node by following https://raw.githubusercontent.com/crvouga/workspace/main/packages/fleet/docs/agent-install.md`. It runs `doctor` first (read-only, every problem at once, the exact disk named), asks you to confirm that disk, and then installs. See [agent-install.md](agent-install.md).

   To see what would happen without risk: `sudo bash fleet-node.sh doctor ci`. Every run writes a redacted log under the state directory (`~/.fleet/logs` before the install, `/nix/fleet-state/logs` after) and prints its path when something fails. After the node boots, `fleet-node status` on it says whether it is healthy.

3. For a role with shared secrets, run `just setup --repos ...` once and apply the vault root (see the README). After that a new node needs no token typed or pasted: the installer asks the repository owner to approve it on GitHub, and the `Fleet enroll` workflow delivers a single-use Vault wrapping token for that role's key, sealed to the node. To hand a token over by hand instead, `just enroll <role>` prints the shell line or the agent prompt, and `--token-file PATH` or `FLEET_ENROLL_TOKEN` supplies it; `--no-enroll` installs without either. The installer unwraps it before the disk is touched, so a spent or wrong token wipes nothing. The path is `vault_kv_secret_v2.fleet` in the vault OpenTofu root, fed by the `fleet_age_keys` input; apply a reviewed plan there first. Or plug in a filesystem labeled `FLEET-KEY` when this role already has a key, or when a later node of the same role must decrypt the same sops file. An existing `<role>.age` is installed. Otherwise the new key is written there. Two role files that compare equal are refused.
4. After the line matches, the machine reboots into the installer for that role. The installer skips USB, removable, and hotplug disks, and anything mounted in the live image. It generates `/nix/fleet-state/secrets/age.key`, installs the closure, prints the public key, and reboots. The private key is not printed. The hostname is `<role>[-gpu][-highmem]-<4 hex>` from the hardware id. No host file is added.
5. Run the same command again after a failure. Run it again after a finished install: a finished install is not wiped a second time.
6. Pull a USB disk if this firmware would boot it again. The console prints the age public key and the host key fingerprint. Encrypt that role's secrets to the public key from any computer, then set `secretsFile`. Leave it null until the file exists. A CI node still needs its GitHub App id and installation id in `settings/github.json` before runners register. Nothing in this package changes GitHub settings.

A blank disk uses the same program's `flash` action. It refuses an internal disk on Windows, macOS, and Linux. Boot the USB disk and choose the role on the installer menu. The menu installs a role selected deliberately in the boot menu.

`just bootstrap ROLE IP` is optional. It SSHs to a live image that already authorizes `settings.sshKeys` and runs `fleet-install` there with the wipe already approved. It does not build and it does not read a key file. With `sshKeys` empty, the download above is the install.

The netboot ramdisk does not carry the role closures, and the netboot host does not serve this ISO. Setting `reinstall.nodes` or `reinstall.roles` does not install a node. Use `fleet-node.sh` on the machine.

A CI hostname looks like `ci-a3f9` or `ci-highmem-02be`. A web hostname looks like `web-a3f9` and does not write `/run/fleet/identity`. To install another node of the same role, boot the same USB and leave the menu on that role. For a shared sops file, plug in the same `FLEET-KEY` volume. The DMI UUID supplies the stable id. No per-node Nix file is added.

## Reinstall from the netboot server

One-time BIOS setup puts the network first and the internal disk second. On every boot the netboot server is asked what to do. With `reinstall.nodes` and `reinstall.roles` both empty, the client boots the local disk (`exit 1` back to firmware, or `sanboot` on BIOS).

The netboot host does not serve an installer that can finish an install. Adding a 4-hex stable id to `reinstall.nodes`, or `ci`, `web`, `cache`, `netboot`, or `devbox` to `reinstall.roles`, does not install a node. Reinstall by running `fleet-node.sh` on that machine. The id `cattle.py` prints is the first 4 hex digits of sha256 of `dmi:` plus the SMBIOS UUID. `ci-gpu` is role `ci`. The installed system writes that role to `/boot/fleet-role.ipxe` on the ESP volume `SHBOOT`. The iPXE script reads it. A machine with no ESP file is selected only by its stable id. Clear a flag in a follow-up commit after `fleet-node.sh` has installed the machine. Leaving a role flagged is not an install.

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

The workflow is `.github/workflows/ci.yml`. It runs on GitHub-hosted `ubuntu-latest`, not on this fleet. One path changes a node: pull request, required checks, merge queue, `main`, nodes pull.

- A pull request that touches this package runs `nix flake check` and builds `ci`, `web`, `cache`, `netboot`, `devbox`, and the installer. `ci-gpu` is not in that build.
- The `Fleet` check reports on every pull request. A diff outside this package succeeds without building, so the queue is not stuck on a skipped workflow.
- The merge queue repeats the check and pushes the four toplevels to attic before the commit reaches `main`. Missing `FLEET_CACHE_URL`, `FLEET_CACHE_NAME`, or `FLEET_ATTIC_TOKEN` fails the queue. Do not invent the cache URL.
- The queue merges with `MERGE`. The commit that was tested and cached is the commit that lands. There is no second cache push after merge.

A rollback is a revert pull request. It uses the same checks and the same queue. The previous systems are already in the cache, so nodes converge by substituting. systemd-boot keeps 8 generations. If SSH is gone, pick an older generation from the console. Nothing force-pushes `main`.

The `main` ruleset (pull request, `Check`, `Fleet`, merge queue, no force-push) is declared in OpenTofu. This package does not apply it. Apply a reviewed plan from `packages/infra`.

Once a week, `.github/workflows/maintenance.yml` opens or updates one pull request that only changes `packages/fleet/flake.lock`. That pull request uses this same path. It does not push `main`.

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

To remove a node, on that node run `fleet-remove` (or `bash fleet-node.sh remove`). It does not stop a busy CI job. It withdraws the node from new work with the credential already on the machine, and it is safe to run twice. When the machine is idle it writes `/nix/fleet-state/withdrawn`, which keeps the runner units from starting again after any reboot, and then powers the machine off by itself. Reinstalling with `fleet-node.sh` wipes that marker. If that credential is missing, it exits non-zero, does not claim the node was unregistered, and prints one next step. No per-node git edit and no SSH session from another computer are required. Role age-key rotation is two commits, described in [secrets/README.md](../secrets/README.md). Do not SSH a new key onto a running node.

A pull request that touches this package runs `nix flake check`, which includes the `follow-up` VM test. That test is required. It does not add a new GitHub status name. The `Fleet` check is the one the ruleset names.

## Caches

Two caches exist and they are not the same:

- The fleet attic cache is `settings.binaryCache` plus the cache role. Clients use it only after the URL and the public key are real and do not contain `TODO`. The server listens on port 8080 and stores data under `/nix/fleet-state/attic`. It stays disabled until `secrets/cache.yaml` provides `attic-env`.
- `cache.remote` in `fleet.nix` is an optional S3 scratch substituter and post-build hook for CI. Leave it off. Do not enable it while `binaryCache.url` is set; both would write `extra-substituters`. Bucket provisioning stays in OpenTofu.

Runner users must never receive the App key, a signing key, or the attic token. Projects can use their own scoped build-cache credentials. Nix signatures do not validate arbitrary project cache objects.
