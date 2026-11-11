# Personal CLI

`personal` is this repository's command for platform and workstation
operations. It runs from the checkout (`bun run personal …`, or the launcher
`bun run personal:install` puts on PATH) and is no longer published.

| Command       | Scope                                                    |
| ------------- | -------------------------------------------------------- |
| `infra-*`     | Platform operations: health, domains, Vault, passwords   |
| `workstation` | This machine's tools, agent profiles and launcher        |
| `commands`    | Command catalog plus the agent usage contract (`--json`) |

Fleet machines, T3 provider instances and the CLI proxy are managed by
[dev-fleet](https://github.com/crvouga/dev-fleet), not by this CLI. Run them
from the checkout with `bash scripts/dev/project-action.sh fleet-sync`
(also `fleet-status`, `fleet-repair`, `infra-cliproxy`), or use the dev-fleet
CLI directly.

```sh
bun run personal                      # help
bun run personal commands --json      # catalog for agents
bun run personal workstation sync --yes
bun run personal infra-vault run --config dev -- COMMAND
```

The checkout is `--workspace`, `PERSONAL_WORKSPACE`, the closest `mise.toml`,
then the current directory.
