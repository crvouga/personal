# Personal developer command center

Public npm distribution: **`@crvouga/personal`**, executable **`personal`**.
The source workspace `@pkgs/personal-cli` stays private; its build bundles the
private fleet library into a standalone Node application. No Bun, repository
checkout, npm login or global installation is needed just to open the application.
Requires Node **22.13+ on the 22.x line, or 23.5+** with npm.

```sh
npx --yes @crvouga/personal
```

The terminal application has a searchable command palette, category submenus,
descriptions, target selection, progress indicators, result summaries, searchable
node/status/check drill-downs, remedies, retry/back navigation, and an add-node
wizard. It shows the equivalent noninteractive command before running anything.
Ctrl+C exits; `NO_COLOR` and narrow terminals are supported. It never clears the
terminal or automatically repairs machines. This is a command console, not an AI
chat service; no model key or chat subscription is required.

## For people and agents

```sh
npx --yes @crvouga/personal@latest commands --json --search ssh
npx --yes @crvouga/personal@latest agent --json
npx --yes @crvouga/personal@latest fleet doctor --local --json
npx --yes @crvouga/personal@latest fleet doctor --all --json
npx --yes @crvouga/personal@latest fleet doctor --node dev-linux --json
```

Pin an **exact released version** instead of `latest` for automation. Direct
commands, `--json`, `--non-interactive` and redirected input never open prompts.
No arguments without a terminal prints the command catalog. JSON is one versioned
document on stdout; interactive chrome and progress use stderr. Exit codes:
**0** success/preview, **1** failed operation/check, **2** invalid usage/config,
**130** cancellation. `--strict` makes warnings and skips fail too.

`commands --json` exposes names, descriptions, categories, keywords, examples and
global flags; `agent --json` documents the output/safety contract; `fleet schema`
exposes the roster schema. JSON error messages never contain raw subprocess
output, environment variables, authentication responses or exception messages.

## Register actual computers

Use the interactive **Fleet setup / add node** action, or preview first:

```sh
personal fleet add --id dev-linux --ssh dev-linux --path /home/dev/workspace --json
personal fleet add --id dev-linux --ssh dev-linux --path /home/dev/workspace --apply --yes --json
personal fleet validate --json
personal fleet onboard --node dev-linux --json
personal fleet doctor --all --json
```

This registers an **existing** computer; it does not provision a host, enable SSH,
accept a host key, log in, copy credentials, or edit SSH configuration. `--runtime`
may specify an absolute Node/Bun executable on the remote machine. The default is
`node` on the non-login SSH PATH. The bundled probe is streamed over SSH; the npm
package need not be installed on remote nodes. Remote targets require POSIX
shells; use WSL for Windows SSH nodes. Native Windows supports local commands.

Roster resolution: `--config`, `PERSONAL_FLEET_CONFIG`, closest ancestor
`.fleet.local.json`, then `~/.config/personal/fleet.json`. New rosters are saved
with mode 0600 using a lock and atomic replacement; existing entries are preserved,
duplicates fail, and symlink rosters are refused. Keep custom roster paths out of
Git. `fleet init` previews **example data**, not discovered machines; creating the
example also requires `--apply --yes`.

Controller checkout: `--workspace`, `PERSONAL_WORKSPACE`, closest ancestor
`mise.toml`, then the current directory. Opening the application requires no
checkout, but repository/dependency/toolchain checks need your actual personal
checkout. A missing checkout or roster is reported, never treated as healthy.

Doctor checks the controller and all configured nodes by default. `--node` limits
remote targets; `--local` skips remote connections and requires no roster. Its
`coverage` explicitly distinguishes all-configured, selected and local checks.
A roster is not discovery of every computer. Run from each intended controller:
directed SSH success is not all-pairs connectivity. T3 peer/relay traversal and
VS Code forwarding still need the operator tests in `fleet onboard`.

## Sync is explicit

```sh
personal fleet sync --node dev-linux --json
personal fleet sync --node dev-linux --apply --yes --json
```

Sync delegates to the existing mise/setup owner, with frozen dependencies. It
does not replace workstation management or OpenTofu. `--pull` requests a
fast-forward-only pull and refuses dirty/detached checkouts. Never run sync on an
untrusted checkout: setup/dependency lifecycle scripts are executable code.
`npx --yes` approves the npm download only, **not** application mutations.

## Development and release

```sh
bun run personal                         # interactive development entry
bun run --cwd packages/personal-cli tc
bun run --cwd packages/personal-cli lint
bun run --cwd packages/personal-cli test
bun run personal:build
```

See [releasing.md](releasing.md) for automatic CI releases, credential sources,
first-publish bootstrap, packed-consumer verification and recovery.
