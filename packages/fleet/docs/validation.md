# Validation record

Validated on 2026-10-10 in the current worktree (macOS ARM64):

- `bun run --filter @pkgs/fleet check`: **pass**, ShellCheck, workflow lint, lock checks and 8 Python tests. Tests reject USB/removable/mounted/missing/duplicate/unstable disk targets, verify root-only atomic short-lived registration-token files, exercise both scopes, custom-label drain, pagination, and busy-job timeout.
- `actionlint .github/workflows/runner-check.yml` and package workflow examples with `actionlint.yaml`: **pass**. The existing `CI` workflow structure passes `actionlint -shellcheck=''`; its full ShellCheck integration reports pre-existing SC2016/SC2129 warnings in unrelated scripts.
- `just --list`, `just check-local`, recipe parsing and a dry-run ISO command: **pass**, using a temporary downloaded official just binary.
- Prettier for changed documentation/config, `git diff --check`, `bun run check:llms`, `bun run check:agents`: **pass**.
- Nix **evaluation**: `nix flake check --no-build --all-systems --no-write-lock-file path:SOURCE`: **pass**, including node, installer, guarded remote disko and mocked VM derivations. A temporary official Nix 2.31.2 Darwin binary with a diverted store was used; Nix was not installed system-wide. Nix verified fetched input hashes and generated the updated `nixos-26.05` lock. The checked source was copied to a temporary space-free path because this checkout path contains spaces. Intel Darwin's upstream end-of-support warning is informational.

## Blocked acceptance checks

The full `nix flake check --system x86_64-linux` was attempted with local jobs/substitution disabled and no remote builders to prevent trying Linux builds in the temporary Darwin store. It reached all three checks and returned **Unable to start any build; either increase '--max-jobs' or enable remote builds**. This Mac has no configured x86_64 Linux builder. The actual node closure build, installer ISO build, VM boot/assertions, offline installer behavior, and optional container/cache integrations **have not passed runtime validation**. Evaluation is not a Linux build or VM test. No physical disk operation, GitHub configuration/secret/billing change, push or deployment was performed.

On a Nix-enabled x86_64 Linux builder, from this package run:

```sh
just check
just build-node
just build-iso
just vm-test
```

`just check` builds every host, the installer ISO, and the `runNixOSTest` checks (`vm`, `web-vm`, `lifecycle`, `follow-up`, `netboot-vm`). The hosted `CI` workflow runs the package check and `nix flake check` for fleet changes. A local evaluation is not green CI.

## 2026-10-12 control-surface change

Bootstrap, `fleet-sync`, the attic and netboot roles, the lifecycle and netboot VM tests, and `.github/workflows/fleet.yml` were added on a Mac without Nix. This change was not evaluated with `nix flake check`, and the VM tests were not executed. Do not treat the 2026-10-10 evaluation above as coverage for this tree. The CI closure changes on purpose: `base.nix` now imports sync, the revision endpoint, the generation limit, and the optional attic substituter. comin was not added; it is not in nixpkgs at `7c8764b7`, and an unlocked input was not pinned from this machine.

Before node installation, fill that role's settings file and its encrypted secret file, rerun the acceptance checks against that exact source, and qualify the real NICs, firmware, thermals, and hardware watchdog. The default template stays evaluable. `fleet-install` runs on the machine and generates the role age key there. Empty `sshKeys` is valid. The boot menu chooses the role. `FLEET_AUTO=1` wipes the disk `select-disk` returned. A manual run still asks for that path to be typed.

## 2026-10-12 interchangeable hardware

Role and capability configuration replaced the MS-A2 profile, the configured disk path, MAC canaries, and `ci-$mac` / `web-$mac` hostnames. `scripts/cattle.py check` is part of the portable check. This change was not evaluated with `nix flake check`, and the VM tests were not executed. Do not treat the 2026-10-10 evaluation as coverage. The CI closure changes on purpose: generic initrd modules, systemd-networkd for wired DHCP, boot-time hostnames, and runner slots derived from the live CPU and RAM. The kernel is no longer pinned to 6.12. `ci-gpu` evaluates as a NixOS configuration and is not in the default build list.

## 2026-10-12 main tracking

Nodes poll `main` and switch only from the binary cache. `deploy` and `canary` are gone. `fleet-drift`, the merge-queue cache push, and the lifecycle VM test were added on a Mac without Nix. `nix flake check` was not run, and the VM tests were not executed. The portable check covers `fleet-sync` and `fleet-drift` with stand-in `nix` and `git`. Do not treat that as a NixOS evaluation.

## 2026-10-13 self-healing

Post-switch health checks, previous-generation rollback, systemd-boot tries-left, the netboot local-disk default, `fleet-disk`, and the `follow-up` nixosTest were added on a Mac without Nix. `nix flake check` was not run. The `follow-up` VM test was not executed. `bun run --filter @pkgs/fleet check` passed: 49 tests OK, covering the sync rollback, the boot-count script, and the netboot decision with stand-ins, plus shell syntax, ShellCheck, workflow copies, and cattle enforcement. Do not treat that as a NixOS evaluation. `monitoring.pushUrl` is unused. No PDU model is integrated. Nothing was deployed and no machine was contacted.

The installer ISO carries the `ci`, `web`, `cache`, and `netboot` closures. Its boot menu installs one of those roles without a work computer, from whatever OS is on the disk or from an empty disk. `just fetch-iso` downloads the `Fleet` workflow artifact. That workflow change was not run. The ISO was not built, flashed, or booted. `bun run --filter @pkgs/fleet check` was not re-run; from `packages/fleet`, `python3 -B -m unittest discover -s tests -p 'test_*.py'` passed with 67 tests OK, and ShellCheck, cattle enforcement, and `git diff --check` passed. Those tests cover `fleet-install`, `fetch-iso`, and `flash-usb` with stand-ins. The netboot ramdisk still does not carry the closures, and the netboot host does not serve the ISO.
