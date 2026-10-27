# Workspace development hooks

Superset and super.engineering run `.superset/run.sh`, which runs `bun run dev`.
Turborepo starts every package with a `dev` script in one interactive TUI. Use the
TUI task list to select a server and inspect its logs. Ctrl+C stops the task tree;
workspace teardown also stops the recorded tree without killing unrelated servers.
A task failure stays visible while other servers continue. Portfolio uses Astro’s
`--ignore-lock` option so it stays in the foreground under Turborepo, including
agent terminals, without replacing another running Astro server.

| Server       | Preferred port | Override            |
| ------------ | -------------- | ------------------- |
| Portfolio    | 4321           | `PORTFOLIO_PORT`    |
| Auth relay   | 8081           | `AUTH_RELAY_PORT`   |
| Remote cache | 8083           | `REMOTE_CACHE_PORT` |

Each server chooses the next free port within 200 ports of its preferred port
and prints its actual URL in its task log. Ports are process-specific; a shared
`PORT` cannot accidentally make all servers bind the same port. Like any
probe followed by process startup, allocation can race another process; retry
if a port is taken during that interval.

Setup copies missing package `.env` files from the primary checkout without
printing their values, then installs the frozen Bun workspace. Existing `.env`
files are preserved. Auth-relay and remote-cache runtime environments are excluded
from copying: their launchers load the selected Vault configuration or explicitly selected fixtures instead.
Turborepo's dev command passes the local environment through;
dev tasks are uncached. The remote cache retains its existing Vault setup task.
Portfolio's dev task loads its GitHub token through `vault run` automatically,
defaulting to `dev` unless `VAULT_CONFIG` is explicitly set. Run `vault login`
first if your local Vault session has expired.

Portfolio and cache retain their `dev` scope unless `VAULT_CONFIG` is overridden.

Auth relay loads its managed credentials through Vault (`AUTH_VAULT_CONFIG`,
otherwise `VAULT_CONFIG`, otherwise `dev`). It requires its real database,
system-client secrets, reachable private upstream and exact issuer/callback
configuration. The relay is still staged/disabled: until reviewed provisioning
and provider setup are complete this task reports missing settings and exits,
while the other tasks continue. It never substitutes mock Google sign-in.
See `packages/auth-relay/operations.md` for the actual deployment gates.

For explicit auth test fixtures, use `AUTH_DEV_MODE=local`. This prepares a loopback Docker stack through OpenTofu/Atlas.

Run `bun run check:dev` to verify all active tasks against fresh auth storage, real
browser redirects, a changed-port restart, and graceful cleanup. It needs a valid
Vault login and Playwright Chromium. This check explicitly selects local auth fixtures; portfolio and remote-cache use the dev Vault scope. Logs are kept under
ignored `.superset/.dev-check/`; normal auth registrations are left intact.
The full repository check needs the toolchain documented in the root README.
