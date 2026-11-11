# Personal CLI agent notes

- `personal` is a private, source-only CLI: `infra-*` passthroughs, `workstation` and `commands`. It is not published.
- It holds no fleet code. Fleet machines, T3 provider instances and the CLI proxy belong to [dev-fleet](https://github.com/crvouga/dev-fleet); never add `fleet-*` or `t3-*` commands back here.
- Keep every command flat and prefixed by domain (`infra-*`, `workstation`, `commands`). Keep JSON versioned, stdout machine-readable, and errors free of raw command output, credentials and exception messages.
