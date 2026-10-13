# Self-hosted CI fleet

This isolated package owns the explicitly authorized NixOS exception to the root OpenTofu rule. It does not own GitHub configuration, buckets, billing, or other workspace infrastructure. Do not provision those here. Hardware profiles are shared; never add per-host Nix files. Every dependency is pinned in `flake.lock`; do not update it implicitly during deployment.

Run `bun run --filter @pkgs/self-hosting check` for portable checks. From this package run `just check`, `build-node`, `build-iso`, `vm-test`, `verify-node NODE`, `status NODE`, `drain-node NODE`, `resume-node NODE`, `deploy NODE`, `rollback NODE`, `provision-secrets NODE KEY`, or `reinstall-node NODE EXTRA_FILES`.

`flash-usb ISO DEVICE`, `reinstall-node`, and booting the installer are destructive. Obtain explicit human approval identifying the disk/node before executing them. An interactive confirmation is an additional check, never authorization. Do not execute a generated installer or a VM against physical disks. Never print secrets, place them in CLI arguments, or copy plaintext credentials into the Nix store. Never change GitHub settings, secrets, or billing without explicit approval. Runtime registration uses the configured GitHub App; tokens remain in `/run`.

Always drain before activation, reboot, rollback, or reinstall; a timeout must prevent the action. Restrict projects to private trusted code, require `nixos` and `ci` routing labels, and never run fork PRs or `pull_request_target` on this fleet. Keep credentials root-only. Inspect actual upstream module source at the locked nixpkgs revision when changing module behavior. Run Linux flake/system/ISO/VM checks and clearly report unavailable builders or hardware validation.
