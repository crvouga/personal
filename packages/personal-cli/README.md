# Personal CLI

`personal` (published as **`@crvouga/personal`**) is the one user command for this
repository. Every command is flat and prefixed by its domain:

| Prefix        | Scope                                                            | Needs the checkout |
| ------------- | ---------------------------------------------------------------- | ------------------ |
| `fleet-*`     | Developer computers: status, discovery, sync, repair, roster     | Only for repairs   |
| `t3-*`        | Declared T3 provider instances on this machine                   | No                 |
| `infra-*`     | Platform operations: health, domains, Vault, CLIProxy, passwords | Yes                |
| `workstation` | This machine's tools, agent profiles and launcher                | Yes                |
| `commands`    | Command catalog plus the agent usage/safety contract             | No                 |

```sh
npx --yes @crvouga/personal              # help, including the release build timestamp
npx --yes @crvouga/personal --version    # 0.1.7 (released 2026-11-07T18:02:11.000Z)
npx --yes @crvouga/personal commands --json
```

Requires Node **22.13+ on the 22.x line, or 23.5+**. Bare invocation prints help,
including on a TTY; `--interactive` opens the searchable palette; `--json` and
`--non-interactive` never prompt. Pin an exact version in automation.

## Fleet

```sh
personal fleet-status                    # this manager + every roster node (read-only)
personal fleet-status --local            # this computer only; no roster or SSH
personal fleet-status --tailnet          # every visible Tailscale computer
personal fleet-status --workers          # canonical worker fleet audit
personal fleet-discover                  # Tailscale computers, including offline
personal fleet-sync --dry-run            # plan the enrolled Ubuntu fleet push
personal fleet-sync                      # push to the enrolled fleet; no prompt
personal fleet-node-sync                 # reconcile this node; applies by default
personal fleet-repair                    # preview owner-managed repairs
personal fleet-repair --list             # repair catalog and native login commands
personal fleet-nodes [--onboard|--schema]
personal fleet-node-add --id ID --ssh ALIAS --path /checkout [--apply --yes]
```

`fleet-status` is always read-only. It checks SSH, authentication, T3, VS Code
and dependency drift from this manager; a missing roster fails explicitly and
directed SSH success is not all-pairs connectivity. `--tailnet` reads the signed-in
Tailscale daemon, excludes iOS/Android/tvOS, and fails coverage for offline,
unregistered or unverified computers. `--workers` audits the canonical fleet in
`packages/fleet/definition.json` against the published input hashes, verifies the
centralized Beszel dashboard (hub reachable, each node registered, connected and
reporting fresh samples) and lists every remaining gap; it needs no checkout on
the manager. Its report carries `dashboardUrl`.

`fleet-sync` pushes one approved immutable revision to every enrolled Ubuntu
worker (and, best effort, macOS 14+ nodes) over verified SSH with one interactive
approval or `--apply --yes`. Machine policy is Ansible: never sleep, no automatic
logout, always-on Tailscale/SSH/Docker/Beszel, the dashboard hub and agents, and
each node's own credential renewal. It never requests a worker password or
interactive sudo after enrollment. `--schedule`
manages the manager-only schedule. Read the
[manager runbook](../fleet/docs/ubuntu-sync.md); full Ubuntu acceptance is still
incomplete and fails closed.

`fleet-node-sync` reconciles locked tools, installs the `personal` launcher, upserts
the Codex proxy profile and reconciles declared T3 instances on this machine. It
applies on invocation; `--dry-run` previews. `--revision FULL_SHA` pins a reviewed
commit; `--id` overrides the hostname-derived node ID.

`fleet-repair` inspects the visible tailnet (or `--local` / `--node`) and previews
allowlisted owner actions: `workspace` (mise/shared setup with frozen dependencies),
`workstation` (`personal:install --yes`) and `providers` (strict Vault-backed
provider sync). Apply with the reviewed `--plan-hash` plus `--apply --yes`; a changed
plan is rejected and fresh diagnostics follow. `--script` emits a reviewable POSIX
script instead. Logins, host trust and resource permissions stay operator steps.

The roster is local and secret-free: `--config`, `PERSONAL_FLEET_CONFIG`, the
closest `.fleet.local.json`, then `~/.config/personal/fleet.json`. `fleet-node-add`
previews until `--apply --yes`, writes 0600 with a lock, never overwrites other
entries and refuses symlinks. Manager checkout resolution: `--workspace`,
`PERSONAL_WORKSPACE`, closest `mise.toml`, then the current directory.

## T3

```sh
personal t3-status                       # exit 1 on drift
personal t3-apply --dry-run --json       # plan; copy planHash
personal t3-apply --plan-hash HASH       # reconcile declared instances
personal t3-apply --import INSTANCE_ID   # adopt an existing instance into ownership
personal t3-cleanup --dry-run            # preview removal of owned instances only
```

Tracked `packages/workstation/agents/t3.json` is desired state. Apply creates and
updates declared instances and removes previously owned instances absent from the
definition. Secrets and unrelated settings are preserved. The reconciler runs on
Node without Bun or live credentials; native Windows preserves settings but
managed proxy execution requires macOS/Linux/WSL.

## Infra and workstation

```sh
personal infra-health [--drift]          # read-only platform report
personal infra-health --fix              # guided fixers through OpenTofu or CI
personal infra-domains
personal infra-vault run --config dev -- COMMAND
personal infra-cliproxy status
personal infra-password-manager doctor
personal workstation doctor --json --non-interactive
```

These forward to their owning implementation in the checkout, keep the owner's
output and authorization semantics, and stream native output. Use `--workspace`
or `PERSONAL_WORKSPACE` to select the checkout. Inspect `personal DOMAIN --help`.

## For agents

`personal commands --json` returns one versioned document with every command,
its help pointer, mutation default, preview command, the global flags, the release
version and build timestamp, and an `agent` section documenting invocation, exit
codes, safety boundaries and reproducible examples. `personal --json` returns the
same document. Exit codes: **0** success/preview, **1** failed operation or check,
**2** invalid usage/config, **130** cancelled. `--strict` fails warnings and skips.
JSON errors never contain raw subprocess output, environment variables,
authentication responses or exception messages.

Mutations: `fleet-sync`, `fleet-node-sync`, `t3-apply` and `t3-cleanup` apply on
invocation and offer `--dry-run`;
`fleet-repair` and `fleet-node-add` preview until `--apply --yes`. `--json` changes
output format only.

## Development and release

```sh
bun run personal                         # help
bun run personal --interactive           # optional interactive menu
bun run --cwd packages/personal-cli tc
bun run --cwd packages/personal-cli lint
bun run --cwd packages/personal-cli test
bun run personal:build                   # embeds the version and build timestamp
bun run --cwd packages/personal-cli smoke
```

The build records the release timestamp that `--version`, help, the palette header
and `commands --json` print, so a reported problem can be matched to the exact
build. See [releasing.md](releasing.md) for automatic CI releases, credential
sources, first-publish bootstrap, packed-consumer verification and recovery.
