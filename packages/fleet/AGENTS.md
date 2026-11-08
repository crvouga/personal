# Fleet agent notes

- Read `README.md` before using or changing this package. It is the operator and agent runbook.
- `personal fleet-nodes --schema` and `personal fleet-repair --list` require no credentials or roster.
- Diagnostics are read-only. Never add automatic repairs, logins, host-key acceptance, agent forwarding, credential copying, or cloud provisioning.
- The public `fleet-sync` flow applies on invocation without a prompt (`--dry-run` previews); read `docs/ubuntu-sync.md` for its incomplete acceptance gates. `fleet-repair` and `fleet-node-add` require explicit `--apply --yes`. Repair delegates tool installation to `scripts/dev/setup.ts`; workstation configuration remains owned by `personal`.
- Ubuntu 26.04 is the accepted worker platform; macOS nodes follow the same phases best effort (`node-converge-darwin.ts`, `workstation/macos`). Declare machine policy in Ansible with `ansible.builtin` modules only and verify it with measured runtime checks; keep bespoke TypeScript for native CLIs/APIs (T3, Beszel enrollment, providers, proxy).
- Keep the roster local and secret-free. It describes developer SSH aliases/checkouts, not desired cloud infrastructure.
- Use stable check IDs, structured remedies and versioned JSON. Never serialize raw subprocess output, environment variables, SSH config, auth responses or exception messages.
- Remote commands target POSIX SSH shells only. Native Windows supports local commands; use WSL for remote nodes.
- Keep command execution bounded and injected in tests. Do not contact real nodes in tests.

- `personal fleet-sync` and `personal fleet-status --workers` are the primary worker contracts. Private rosters cannot waive canonical worker requirements. Keep health read-only; never classify expired/unavailable required authentication or unverified firmware recovery as healthy. Worker sudo and SSH are noninteractive; missing administrator enrollment is action-required, never a password prompt.
