# Fleet agent notes

- Read `README.md` before using or changing this package. It is the operator and agent runbook.
- `bun run fleet help` and `bun run fleet schema` require no credentials or roster.
- Diagnostics are read-only. Never add automatic repairs, logins, host-key acceptance, agent forwarding, credential copying, or cloud provisioning.
- Sync and roster creation require explicit `--apply --yes`. Sync delegates tool installation to `scripts/dev/setup.ts`; workstation configuration remains owned by `ws`.
- Keep the roster local and secret-free. It describes developer SSH aliases/checkouts, not desired cloud infrastructure.
- Use stable check IDs, structured remedies and versioned JSON. Never serialize raw subprocess output, environment variables, SSH config, auth responses or exception messages.
- Remote commands target POSIX SSH shells only. Native Windows supports local commands; use WSL for remote nodes.
- Keep command execution bounded and injected in tests. Do not contact real nodes in tests.
