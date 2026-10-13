Provisions resources through provider APIs, including DNS, networking, and anything that routes to the fleet. Machine configuration lives in `../fleet`.

OpenTofu in `tofu/` is the only tool that creates or changes cloud resources. Do not define NixOS hosts, physical disks, or fleet systemd services here. Read-only health checks may observe the runner fleet in `../fleet/fleet.nix`; they must not provision or reconcile it.

See `tofu/README.md` for roots, state, and migration rules.
