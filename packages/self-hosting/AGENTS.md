NixOS configurations for physical machines we own and run ourselves: CI runners, web servers, and later GPU and dev boxes. Nothing here provisions cloud resources; cloud infrastructure lives in `../infra`.

`modules/` holds reusable NixOS modules. `base.nix` is the only module shared by every role: users, SSH, the sops age-key path, store maintenance, watchdog, and disk layout. `hosts/` composes one role for a class of identical machines. Do not put role switches in `base.nix`.

To add a role, add `modules/<role>.nix` with only that role's services, users, and secrets, then add `hosts/<role>.nix` that imports `base.nix` and that module. Wire a new `nixosSystem` in `flake.nix` with its own settings file. Nodes of one role stay identical; hardware differences are shared files in `profiles/`, never per-host files.

To add a host of an existing role, build and install that role's closure. Do not add a host file. Identity comes from the NIC MAC.

To add an app on the web role, append one attrset to `apps` in `web.nix`: `name`, `domain`, `port`, `containerPort`, and `image` (the OCI image CI already publishes). Set `envSecret` only together with this role's encrypted `secrets/web.yaml`. A null `image` is the local placeholder used until those values are real.

CI runner hosts never share secrets or credentials with other roles. The GitHub App key, runner users, slot cache, and `secrets/fleet.yaml` stay in `ci-runner.nix` and `fleet.nix`. Web apps use a different age key and `secrets/web.yaml`. Do not copy either onto the other role. CI runs untrusted pull-request code.

This package does not own GitHub configuration, buckets, billing, DNS, or other workspace infrastructure. Do not provision those here. Every dependency is pinned in `flake.lock`; do not update it implicitly during deployment.

Run `bun run --filter @pkgs/self-hosting check` for portable checks. From this package run `just check`, `build-node`, `build-web`, `build-iso`, `vm-test`, `verify-node NODE`, `status NODE`, `drain-node NODE`, `resume-node NODE`, `deploy NODE`, `rollback NODE`, `provision-secrets NODE KEY`, or `reinstall-node NODE EXTRA_FILES`. `deploy` and `provision-secrets` are for CI nodes.

`flash-usb ISO DEVICE`, `reinstall-node`, and booting the installer are destructive. Obtain explicit human approval identifying the disk/node before executing them. An interactive confirmation is an additional check, never authorization. Do not execute a generated installer or a VM against physical disks. Never print secrets, place them in CLI arguments, or copy plaintext credentials into the Nix store. Never change GitHub settings, secrets, or billing without explicit approval. Runtime registration uses the configured GitHub App; tokens remain in `/run`.

Always drain a runner before activation, reboot, rollback, or reinstall; a timeout must prevent the action. Restrict runner projects to private trusted code, require `nixos` and `ci` routing labels, and never run fork PRs or `pull_request_target` on the runner fleet. Keep credentials root-only. Inspect actual upstream module source at the locked nixpkgs revision when changing module behavior. Run Linux flake/system/ISO/VM checks and clearly report unavailable builders or hardware validation.
