Cloud infrastructure only. Machines we own and run ourselves are defined in `../self-hosting`.

OpenTofu in `tofu/` is the only tool that creates or changes cloud resources. Do not define NixOS hosts, physical disks, or self-hosted systemd services here. Read-only health checks may observe the runner fleet in `../self-hosting/fleet.nix`; they must not provision or reconcile it.

See `tofu/README.md` for roots, state, and migration rules.
