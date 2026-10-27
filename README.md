# Workspace

Bun + Turborepo monorepo for the portfolio at https://www.chrisvouga.dev, a dormant Turborepo remote cache, an OpenBao secrets service, shared libraries and local workstation tools.

Infrastructure is managed exclusively by **OpenTofu**. The resource definitions, canonical fleet inventory, provider locks and migration instructions live in [packages/infra/tofu](packages/infra/tofu/README.md). No custom provisioning or reconciliation controllers remain.

```bash
bun install
bun run check                 # requires OpenTofu 1.13.0 and Playwright Chromium
bun run infra plan            # foundation: Railway project, Vault host, PlanetScale Postgres, R2, Cloudflare, GitHub
bun run infra:bootstrap plan  # initialization and seal state
bun run infra:vault plan      # policies, authentication, tokens and KV values
bun run infra:fleet plan      # application services, images, variables and DNS
```

Import existing resources before applying. State and plans are encrypted; credentials and secret tfvars are never committed. See the migration guide for bootstrap and import prerequisites.

| Package                                                                                    | Purpose                                                                   |
| ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------- |
| `portfolio`                                                                                | Astro static site, content registry, GitHub insights and generated resume |
| `turborepo-remote-cache`                                                                   | Dormant Bun cache server; source and tests retained                       |
| `infra`                                                                                    | OpenTofu infrastructure and read-only build/health adapters               |
| `vault-service`                                                                            | OpenBao runtime image and local Vault auth/read CLI                       |
| `9router`                                                                                  | Railway routing app with ephemeral SQLite and shared R2 backups           |
| `workstation`                                                                              | Portable local machine configuration; `ws` dashboard                      |
| `assert`, `logger`, `object-store`, `openrouter`, `secret-store`, `secret-string`, `vault` | Shared libraries                                                          |

[CI](.github/workflows/ci.yml) validates every PR and merge-queue entry, runs the required platform tests, and calls [Deploy](.github/workflows/deploy.yml) after successful main-branch checks. Deploy builds images, applies OpenTofu in order and probes production. [Maintenance](.github/workflows/maintenance.yml) handles health reports, snapshot/dependency update PRs and manual secret repair. Sibling repositories use [Publish](.github/workflows/publish.yml); the old CI publishing interface stays compatible. Runner check and Fleet enroll retain their separate trust boundaries. OpenTofu owns publisher files, dispatch secrets and the required-check ruleset.

The generated [llms.txt](llms.txt) explains how other projects integrate with Vault, PostgreSQL, remote caching, object storage and fleet hosting. The portfolio publishes it at [www.chrisvouga.dev/llms-infra.txt](https://www.chrisvouga.dev/llms-infra.txt); the site's own `/llms.txt` is a candidate summary for recruiters' screening agents and links to it. Regenerate it with `bun run llms:sync` after changing the infrastructure inventory or integration contract.

Local setup: install [mise](https://mise.jdx.dev/), then `mise install` from the repo root. Tool versions live in `mise.toml`, including `just`, `gh`, `age`, `sops`, ShellCheck, actionlint, OpenTofu 1.13.0, Bun 1.3.11, Node 22.22.3, and Atlas. Add `eval "$(mise activate zsh)"` to the shell so those tools are on `PATH`. Then `bun run setup` installs dependencies and `vault login` enables managed application settings. `bun run dev` starts the active applications; the retired Turbo/Nix cache stays dormant. Fleet builds missing system closures locally with upstream Nix substitutes. [Workstation setup](packages/workstation/README.md) uses `bun run ws:install`.

After pushing, watch the complete CI run with `bun run gh:ci:watch`; local checks do not validate production deployment.

## Update secrets

```bash
bun run vault:edit             # interactive secret editor
bun run vault:edit --google    # Google client ID and secret together
bun run vault:edit --dry-run   # review plans without applying
bun run vault:edit --demo      # explore with synthetic data; no live connections
```

Choose production, development or both, then enter hidden values. The editor
offers registered operator-supplied keys, searchable by name or consuming app.
Enter keeps the existing value in each environment. The review shows key names
and whether each value will be added, replaced or synchronized; values stay hidden.

The editor preserves the complete managed input maps, administrator passwords and
fleet keys. It saves the persistent deployment inputs through the foundation
OpenTofu root, then updates Vault. Google changes also update the selected relay
instances directly through the auth root; the screen shows the exact Google
redirect URIs. Other applications that load secrets at startup need a subsequent
deployment. Production provider-token changes also update their managed CI copy.

Run from an interactive terminal with the pinned tools (`mise install`) and
`vault login` as an administrator. State and deployment credentials load
automatically from the OpenTofu-managed, admin-only `secret/infra/operator`
document. The editor never asks for R2 keys, state encryption material or provider
credentials. Application and CI read tokens cannot access that document. If its
setup is missing, the command stops with a setup error; deploy the Vault OpenTofu
root through CI, which already has the bootstrap credentials, then retry.
Every apply requires approval of a saved plan. The editor refuses missing adopted
resources, replacements, deletions and unselected field changes. Temporary inputs
are private to the run and removed on exit. Cancelling during an apply does not
roll back completed operations; after a partial failure, re-run with the same
values to finish synchronization. `--dry-run` still needs state/provider access;
`--demo` needs none.

Use `bun run vault:fix` to repair missing deployment inputs. `vault:secrets` remains
the lower-level complete-map renderer, rather than an editor for individual keys.

## Infra health

All 14 domain registrations remain at Squarespace. The Cloudflare migration is cancelled; the four existing Cloudflare DNS zones are preserved. `bun domains inventory` and `bun domains discover` provide read-only observations. See the [cancellation record](packages/infra/docs/domain-migration.md) for cleanup evidence and the accepted unused-domain DNSSEC setting.

`bun run health` is the single place to check whether the platform is configured correctly and healthy. It reads the OpenTofu inventory and reports on everything it declares:

| Group       | Checks                                                                                  | Needs             |
| ----------- | --------------------------------------------------------------------------------------- | ----------------- |
| `inventory` | Offline consistency: unique ids and hostnames, dangling references, policy files        | —                 |
| `dns`       | Cloudflare delegation and every declared record                                         | —                 |
| `domains`   | Retained registration/delegation, DNSSEC, existing DNS records and HTTPS                | Cloudflare token  |
| `tls`       | Certificate trust and expiry for every public hostname                                  | —                 |
| `services`  | Each Railway service's health endpoint; Cloudflare redirects                            | —                 |
| `tunnels`   | Cloudflare tunnel connectors (an offline workstation connector warns)                   | —                 |
| `vault`     | Seal state and shares; KV mount, policies, auth roles, users and required KV keys       | Vault token       |
| `storage`   | R2 buckets, PostgreSQL, service databases (`SELECT 1`)                                  | Vault token       |
| `images`    | Every deployed GHCR image is publicly pullable                                          | —                 |
| `github`    | Repositories, publisher workflows, dispatch secrets, merge gate, last production CI run | GitHub token      |
| `runners`   | Self-hosted runner fleet registrations                                                  | GitHub token      |
| `drift`     | State objects exist; with `--drift`, `tofu plan` finds nothing to change in any root    | initialized roots |

```bash
bun run health                       # everything except tofu plan, a few seconds
bun run health --verbose             # list passing checks too
bun run health --drift               # also plan every initialized OpenTofu root
bun run health --only services,vault # a subset; --skip excludes
bun run health --json                # machine-readable
```

It is read-only: probes, reads and unlocked plans. A check that cannot run (no `vault login`, no `gh auth login`, root not initialized) reports `SKIP` with the reason and never counts as a pass. The exit code is 1 on any failure; `--strict` also fails on warnings and skips.

The read-only Health job in [Maintenance](.github/workflows/maintenance.yml) runs the full report, including drift, every day and on demand (`gh workflow run maintenance.yml -f task=health`); its job summary is the same report. `bun run health-check` remains the narrower post-deploy URL probe used inside CI.

## Password manager

Local account discovery and Bitwarden maintenance live in
[`packages/password-manager`](packages/password-manager/README.md). Start with
`sh scripts/password-manager-setup.sh`; root `bun run password-manager ...`
commands operate outside Turbo. State and credentials remain private and local.
See the package's operator guide and acceptance ledger for the supported automation
and the distinction between fixture-tested and live-verified behavior.
