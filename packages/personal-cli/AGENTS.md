# Personal CLI agent notes

- This private workspace builds the public `@crvouga/personal` npm distribution in `dist/`. Never publish the workspace root or internal `@pkgs/*` dependencies.
- Inside this checkout (any subdirectory) `npx @crvouga/personal` runs the working-tree source through the workspace link and root `devDependencies`, so unpublished changes apply immediately with no build. Keep the workspace name, `bin` and root `workspace:*` entry in sync; `@latest` or a version still fetches from npm.
- Read `README.md`. Bare invocation prints help, including on a TTY. Only explicit --interactive opens the menu; direct commands and JSON never prompt.
- Keep every command flat and prefixed by domain (`fleet-*`, `t3-*`, `infra-*`, `workstation`, `commands`); variants are flags, never nested subcommands or aliases. Preserve the same command registry for interactive discovery and agents. Keep JSON versioned, stdout machine-readable, and errors free of raw command output, credentials and exception messages.
- Diagnostics are read-only. The canonical `fleet-node-sync` command applies by invocation and offers `--dry-run`. `fleet-node-add` and `fleet-repair` writes require `--apply --yes`. Never run setup from installation hooks.
- `fleet-sync` uses a manager-driven approval flow; see `../fleet/docs/ubuntu-sync.md`. Never turn an incomplete machine acceptance result into a successful receipt.
- Fleet configuration is local, secret-free developer metadata, not cloud inventory. Workstation/mise own local convergence; OpenTofu exclusively owns infrastructure.
- Publish only reviewed, tested tarballs. Never include a roster, credentials, environment files, source maps, state, or arbitrary workspace files. Do not copy authentication between machines.
- Tests must inject subprocess runners and use temporary rosters; no real hosts, login flows or publishing in tests.
