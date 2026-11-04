# Personal CLI agent notes

- This private workspace builds the public `@crvouga/personal` npm distribution in `dist/`. Never publish the workspace root or internal `@pkgs/*` dependencies.
- Read `README.md`. Bare invocation opens a terminal command palette only with a TTY; direct commands and JSON never prompt.
- Preserve the same command registry for interactive discovery and agents. Keep JSON versioned, stdout machine-readable, and errors free of raw command output, credentials and exception messages.
- Diagnostics are read-only. Configuration writes and sync require `--apply --yes`; interactive confirmations must translate to those same flags. Never run setup from installation hooks.
- Fleet configuration is local, secret-free developer metadata, not cloud inventory. Workstation/mise own local convergence; OpenTofu exclusively owns infrastructure.
- Publish only reviewed, tested tarballs. Never include a roster, credentials, environment files, source maps, state, or arbitrary workspace files. Do not copy authentication between machines.
- Tests must inject subprocess runners and use temporary rosters; no real hosts, login flows or publishing in tests.
