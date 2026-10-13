# Validation record

Validated on 2026-10-10 in the current worktree (macOS ARM64):

- `bun run --filter @pkgs/self-hosting check`: **pass**, ShellCheck, workflow lint, lock checks and 8 Python tests. Tests reject USB/removable/mounted/missing/duplicate/unstable disk targets, verify root-only atomic short-lived registration-token files, exercise both scopes, custom-label drain, pagination, and busy-job timeout.
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

`just check` builds the `ms-a2` system, offline ISO and `runNixOSTest` in the flake's checks. The existing hosted `CI` workflow now runs these checks for fleet changes and includes the job in `Required`. CI has not run yet; a local evaluation is not green CI.

Before node installation, fill `fleet.nix` and the encrypted secret file, rerun the acceptance checks against that exact source, and qualify the real MS-A2 NICs, target disk path, firmware/UEFI behavior, thermal stability and hardware watchdog. The default template deliberately remains evaluable while its installer refuses absent SSH keys, secrets or an unverified target disk.
