# Fleet operations

## Preparation and node #1, in order

Use a Nix-enabled x86_64 Linux work computer or a configured Linux remote builder. A macOS work computer can evaluate and orchestrate; it cannot build x86_64 Linux closures or run the VM test without a Linux builder. Install `just`, Nix with `nix-command flakes`, `age`, and `sops`. Work in `packages/self-hosting`.

1. Back up all Windows data you need. Installation erases the internal target NVMe. Obtain explicit human approval of that disk. Do not execute the installer on another machine.
2. In Windows, note firmware version and NIC MACs. If OOBE prevents boot selection, complete only the setup needed to shut down or use firmware's one-time USB boot menu. Firmware key sequences vary: use the manufacturer's instructions, not an assumed key.
3. BIOS checklist: disable Secure Boot; enable UEFI USB boot; enable power-on after AC loss if available; enable a hardware watchdog only if offered. Record these settings. Boot a standard non-destructive Linux rescue stick first to inspect `lsblk -o NAME,MODEL,SERIAL,TRAN,SIZE,MOUNTPOINTS`, `ls -l /dev/disk/by-path`, `lspci -nnk`, and `ethtool -i INTERFACE`.
4. Set `fleet.nix.disk` to the verified **internal NVMe PCI by-path** shared by this profile. A serial-based by-id differs per node, so do not use it for an identical fleet unless the profile really shares that path. Multiple NVMe slots must have a deliberate target slot. USB paths, raw `/dev/nvme0n1`, missing targets, removable/hotplug disks, and mounted descendants are rejected. Record actual LAN/DHCP/DNS and SSH reachability. Add your work computer's public SSH key to `sshKeys`.
5. Choose GitHub scope and configure `github` in `fleet.nix`. Organizations can share a group across selected private repos; personal accounts must use `scope = "repository"` and `repositories = [ "owner/private-repo" ... ]`. These are operator decisions; nothing in this package changes GitHub settings. With human approval, create/install a GitHub App with organization **Self-hosted runners: write**, or repository **Administration: write**, as required by the [registration API](https://docs.github.com/en/rest/actions/self-hosted-runners). Install it only on intended trusted scopes. Fill App ID and installation ID. Restrict the group to selected private repositories; disable public access and restrict workflows where your plan supports it. Do not switch any production workflows yet.
6. Generate and back up one fleet age key on the work computer, then encrypt the App PEM. Commands below keep plaintext outside the repo:

   ```sh
   umask 077
   mkdir -p "$HOME/.config/self-hosting"
   age-keygen -o "$HOME/.config/self-hosting/fleet-age.key"
   age-keygen -y "$HOME/.config/self-hosting/fleet-age.key" # public recipient only
   # Write a YAML document outside Git with github-app-key: | followed by the PEM.
   # Use your editor/password manager; do not paste key material into shell history.
   sops --encrypt --age AGE_PUBLIC_RECIPIENT --input-type yaml --output-type yaml      "$HOME/.config/self-hosting/fleet.plain.yaml" > secrets/fleet.yaml
   ```

   Replace the public recipient placeholder in `.sops.yaml` too. Set `secretsFile = ./secrets/fleet.yaml;` in `fleet.nix`; commit only encrypted YAML. No fake encrypted placeholder is shipped. Remove the local plaintext document after storing a secure backup. The ISO includes encrypted YAML through its system closure, **never** the age key. SOPS decryption and registration initially fail safely until you transfer the key.

7. Validate and build from the same committed lock and settings:

   ```sh
   cd packages/self-hosting # if starting at repository root
   just check-local
   just check
   just build-node
   just build-iso
   ls result-iso/iso/*.iso
   ```

8. On Linux, identify the USB using `lsblk` and `udevadm info`, unmount every partition, and flash with the exact stable path:

   ```sh
   just flash-usb result-iso/iso/ci-ms-a2-installer.iso /dev/disk/by-id/usb-EXACT_DEVICE
   ```

   The script displays model/serial/mounts, requires USB transport, refuses mounted descendants, and requires typing the full path. It overwrites the USB. On macOS the Linux guard script intentionally refuses to run: use Disk Utility or a reviewed flashing tool, or manually inspect `diskutil list external physical`, then `diskutil info /dev/diskN`, confirm that it is the intended whole **external USB** device and not the system disk, obtain approval, `diskutil unmountDisk /dev/diskN`, and `sudo dd if=ISO of=/dev/rdiskN bs=4m`. Recheck the identity immediately before writing, then `sync` and eject. Never infer a disk number from an example.

9. Boot the generated stick at the MS-A2. The tty1 warning counts down ten seconds; **any key aborts**. The disk guard runs before disko. Installation copies the already-built system closure from the ISO, with substituters disabled and no network requirement, then powers off. On failure it does not power off or silently choose another disk; inspect `journalctl -u fleet-install` from another console. After success remove USB, power on, and locate the DHCP lease. The hostname is `ci-` plus the lowest permanent physical NIC MAC with colons removed; changing NIC hardware can change identity.
10. Verify the SSH host fingerprint using the local screen (`ssh-keygen -lf /nix/fleet-state/ssh/ssh_host_ed25519_key.pub`) before accepting it on the work computer. Then provision the age key and verify:

    ```sh
    just provision-secrets NODE "$HOME/.config/self-hosting/fleet-age.key"
    just status NODE
    just verify-node NODE
    ```

    The key travels over SSH stdin directly to `/nix/fleet-state/secrets/age.key` with mode 0600. It never enters `/tmp`, an argument, stdout, the Nix store, or Git. The script restarts SOPS decryption and runners. Confirm `ci-MAC-slot-N` runners carry `self-hosted`, `Linux`, `X64`, `nixos`, `ci`, and `ms-a2`. `verify-node` compares a locally built toplevel path with `readlink /run/current-system` exactly; it proves the closure, not firmware, disk contents, runtime files, or secret equality.

## Deploy, pull updates, drain and rollback

`just deploy NODE` builds first, copies the closure over verified SSH, drains, writes the system profile and boot generation, then reboots. It does not perform an unsafe live switch. If drain fails, activation/reboot are blocked. A build/copy failure happens before drain. The previous generation remains bootable; this SSH deployment uses manual rollback, not deploy-rs magic rollback.

`just drain-node NODE` sets an admission barrier and removes custom routing labels from this node's GitHub runner registrations through its App. Workflows **must require `nixos` and `ci`**; jobs targeting only `self-hosted` evade label-based scheduling restrictions. Busy jobs finish without a stop signal. A job already dispatched at the barrier may fail its start hook before project steps run; retry it on another node. GitHub is polled until no matching runner is busy, then local services stop. An API/access error or timeout leaves the barrier set and prevents deployment. `just resume-node NODE` clears it and re-registers each slot with fresh labels/tokens. Always check logs after a timeout.

For pull updates set the reviewed `updates.flake` URL (for this repository include `?dir=packages/self-hosting`), calendar, and `enable = true`. Updates build before draining and stagger by a deterministic hostname checksum delay within a two-hour window. Private flake sources need a separate read-only retrieval mechanism; the App PEM is not reused for GitOps source access. Prefer a public non-secret config source or an approved SSH deploy key installed outside the Nix store. Failed pulls do not change the running generation. GitOps pulls reviewed commits; it does not update `flake.lock` itself. Keep runner pins current through dependency-update PRs and Linux validation: GitHub requires disabled-auto-update runners to update within 30 days of a new runner release. There is no automatic recovery of failed boots without a BMC; keep the screen/keyboard available.

`just rollback NODE` drains, selects the previous generation and reboots. If SSH is lost, use the systemd-boot menu to select the previous generation physically. Never reboot or switch directly during a job. `fleet-resume` is required after a failed deployment that left the node drained.

## Reinstall, remove and add nodes

`just reinstall-node NODE EXTRA_FILES` is **destructive**, requires human approval and typing the exact configured stable disk path, and drains before the pinned nixos-anywhere tool kexecs into rescue, runs the guarded disko closure, installs and reboots. Linux closure builds require a Linux builder. Prepare `EXTRA_FILES` outside Git with `nix/fleet-state/secrets/age.key` (0600, parent directories 0700); it is copied into the new persistent `/nix` during install. Never embed it into a flake. Optionally preserve the verified SSH host key under `nix/fleet-state/ssh/` in this tree; otherwise verify the new fingerprint physically and remove only the old known_hosts entry for that node. Ensure the installed encrypted config matches this key before reinstalling. Remote kexec depends on hardware, firmware and network; if it fails, use the physical ISO. No destructive operation was run during implementation.

To remove a node, drain and leave the barrier set, power it off after verifying no jobs, then remove offline registration entries through approved GitHub administration. Do not blindly delete a busy runner. To add another node, use the exact same profile ISO, verified target PCI slot, and shared key; its MAC supplies identity. No per-node Nix file is added.

After a RAM upgrade, update `profiles/ms-a2.nix` RAM assumptions fleet-wide, or set `fleet.nix.slots` explicitly and build/test/deploy. Hardware variants should be new shared profiles, not host files. At 96 GiB the physical-core rule caps this profile at 8 slots. Measure concurrent project RAM/CPU use; hardware capacity and selected-repository distribution are finite.

## On-node health and cache operations

```sh
systemctl --failed
systemctl status 'github-runner-*'
journalctl -u github-runner-slot-1 -b
journalctl -u fleet-update -u fleet-cache-clean -b
journalctl -u sops-install-secrets -u fleet-identity -b
journalctl -k -b | grep -Ei 'watchdog|nvme|i40e|igc|r8169|error'
readlink /run/current-system
df -h / /nix /boot
du -sh /nix/ci-cache/*
systemctl list-timers
ls -l /dev/watchdog*
cat /sys/class/watchdog/watchdog*/identity
systemctl show -p RuntimeWatchdogUSec
fleet-drain 7200
# Perform approved maintenance only after success.
fleet-resume
```

The manager requests a 30-second hardware watchdog and panic reboot, but recovery from a hard hang requires an actual supported hardware watchdog. Do not mistake `softdog` for proof of hard-hang recovery. MS-A2 watchdog availability must be verified on the physical unit; no unverified driver or BIOS option is asserted. Nix GC runs weekly (14-day old generations) and store optimisation daily. Hourly cache cleanup enforces a 100-GiB soft ceiling and 30-GiB free-space floor; active runner caches are not deleted. If the floor cannot be restored, new registrations are blocked and the service reports failure. These are soft guardrails, not filesystem quotas: a large active job can fill the disk. Drain, reclaim disposable caches, and resume explicitly.

Reinstall first with a known-good pinned closure. If failures persist, investigate RAM, NVMe SMART, thermal/power issues, firmware, and NIC logs. Do not add speculative kernel flags to hide a hardware problem.

## Optional shared cache

Set only `cache.remote.enable = true` after filling its URL/public signing key and adding encrypted `cache-credentials` (AWS shared-credentials INI) and `cache-signing-key` to the SOPS YAML. This enables an S3 substituter and a signed post-build push hook. Bucket and credential provisioning stay outside this package and require separate approval/OpenTofu ownership. Use [Nix's S3 cache documentation](https://nix.dev/manual/nix/latest/store/types/s3-binary-cache-store), an S3-compatible endpoint such as R2, `region=auto`, and least-privilege bucket-only credentials. Bootstrap misses build locally; push failures appear in daemon logs and must be resolved before relying on remote caching. Runner users must never receive the App key or host binary-cache signing key.

Projects can use their own S3 build-cache clients against a separate prefix/bucket with their own approved scoped credentials. Nix signatures do not validate arbitrary project cache objects. Shared Nix cache and application build-cache protocols are separate; disabling remote cache leaves local Nix/store and slot cache behavior available. Persisted credentials, Nix store and caches are disposable for recovery, but backups of fleet age and signing keys must exist outside the nodes.
