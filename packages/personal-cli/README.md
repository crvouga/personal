# Personal developer command center

Public npm distribution: **`@crvouga/personal`**, executable **`personal`**.
The source workspace `@pkgs/personal-cli` stays private; its build bundles the
private fleet library into a standalone Node application. No Bun, repository
checkout, npm login or global installation is needed just to open the application.
Requires Node **22.13+ on the 22.x line, or 23.5+** with npm.

```sh
npx --yes @crvouga/personal
```

The terminal application has a flat searchable command palette sorted A–Z with group prefixes,
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

## Check every Tailscale computer

```sh
npx --yes @crvouga/personal@latest fleet discover --json
npx --yes @crvouga/personal@latest fleet health --json
```

`discover` reads the signed-in local Tailscale daemon, includes offline computers
and excludes iOS, Android and tvOS devices. `health` checks every visible computer,
including this controller. It pings online peers, checks registered computers over
fresh verified SSH sessions, compares checkout/toolchain input hashes, checks each
pinned tool version and Docker runtime, and runs the existing read-only `ws doctor`
for managed links, PATH and workstation configuration.

Register remote computers with their existing SSH aliases and actual checkout paths.
DNS names, Tailscale addresses and resolved SSH aliases are matched exactly. Missing,
ambiguous, offline or no-longer-visible registrations produce explicit failures;
the command never guesses a username/path or silently reduces the checked fleet.
`fleet nodes` before registration shows an empty list and setup guidance.

Authentication checks cover Codex, Claude Code, GitHub, Vault, T3, Railway, Vercel,
Cloudflare, AWS's active profile and npm. Their status/identity commands run on each
computer as its SSH user; browser login on another computer does not authenticate
that session. Credential values and account responses are withheld. Codex/Claude
status reports do not prove quotas, model access or a live billable request.
Gemini, Copilot and OpenCode provider access are explicitly **unverified** until a
supported noninteractive adapter can verify them; saved keys alone never count.

Health uses strict coverage: warnings and skipped checks return exit **1**, as do
failures. It cannot certify devices hidden by Tailscale ACLs, other accounts/tailnets,
all-pairs connectivity, every application, or operator-only T3/VS Code connection
flows. Those limits remain visible in the report. Per-node health probes default
to five minutes, overridable with `--timeout`; concurrency is bounded to four.
Commands only diagnose; they never log in, install tools, rewrite configuration,
or repair machines automatically. Use `--workspace` to select the reference checkout.

The palette lists all commands directly, for example **Fleet: Check all Tailscale
computers**, **Fleet: Discover Tailscale computers** and **Session: Workspace / config**.
Node lists and the first checks needing attention display immediately; detailed
reports remain available without navigating category submenus.

## Register actual computers

Use the interactive **Fleet: Register a developer computer** action, or preview first:

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

## Preview and apply repairs

```sh
personal fleet repairs --json
personal fleet repair --json                        # all visible Tailscale computers
personal fleet repair --local --json                # this computer only
personal fleet repair --node dev-linux --json       # selected registered computer
personal fleet repair --local --repair workspace --json
# Copy planHash from the reviewed preview; it rejects changed plans:
personal fleet repair --local --repair workspace --plan-hash REVIEWED_SHA256 --apply --yes --json
personal fleet repair --local --repair providers --apply --yes --json
personal fleet repair --local --script              # emit a POSIX script; never execute it here
```

The flat palette includes **Fleet: Explore repairs and login commands** and
**Fleet: Repair tools and configuration**. Applying from the palette carries the
reviewed plan hash. Plan previews exit 0 even when `healthOk` is false: a valid
plan is not a healthy computer. `--repair` selects from `workspace`, `workstation`
and `providers`; omitted selection includes the eligible owner actions identified
by the failed checks. Explicit selection also supports rerunning an owner action.

`workspace` uses existing mise/shared setup and frozen dependencies. `workstation`
uses `ws:install --yes` and can update launcher/PATH, managed links, notifications
and provider configuration. `providers` uses the existing strict Vault-backed
workstation provider sync. Each computer uses its own Vault authorization; the
controller never transfers credential files, tokens, SSH agents or keychains.
Native login recipes are operator steps and are commented in generated scripts.
Use an intended Vault project/config for runtime access, for example
`vault run --config dev -- personal fleet health --json`, only when those secrets
are needed by that process.

Only registered, successfully probed remote machines are eligible for automatic
repairs. SSH host trust, unavailable computers, conflicting Git changes, native
account approvals, service permissions and manual end-to-end tests stay explicit
operator work. Unknown future checks also receive an operator step rather than
being omitted. A successful repair command is followed by fresh checks; remaining
failures, warnings or skips return exit 1. Reports separate `executionOk`,
`healthOk`, completed owner commands, and remaining steps. Actions run serially;
a failure stops later actions on that computer. Partial changes are possible.

Generated scripts require a POSIX shell and are for review in the operator's own
terminal. They use existing checkout tooling; they do not require a globally
installed `personal` on remote machines. They are point-in-time scripts without
CLI plan-hash enforcement. Prefer the guarded CLI apply path and obtain a fresh
whole-tailnet health report afterward.

See [fleet access and repair research](../fleet/docs/access-and-repair-research.md)
for the comparison of mise, OpenBao, Bitwarden, 1Password, Tailscale SSH, chezmoi,
Teleport, Ansible and Syncthing, plus existing password-manager onboarding and
the distinction between shared service secrets and per-machine logins.
