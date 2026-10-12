# Workspace

Bun + Turborepo monorepo for the portfolio at https://www.chrisvouga.dev, a Turborepo remote cache, an OpenBao secrets service, shared libraries and local workstation tools.

Infrastructure is managed exclusively by **OpenTofu**. The resource definitions, canonical fleet inventory, provider locks and migration instructions live in [packages/infra/tofu](packages/infra/tofu/README.md). No custom provisioning or reconciliation controllers remain.

```bash
bun install
bun run check                 # requires OpenTofu 1.13.0 and Playwright Chromium
bun run infra plan            # foundation: Railway project, Vault host, Neon, R2, Cloudflare, GitHub
bun run infra:bootstrap plan  # initialization and seal state
bun run infra:vault plan      # policies, authentication, tokens and KV values
bun run infra:fleet plan      # application services, images, variables and DNS
```

Import existing resources before applying. State and plans are encrypted; credentials and secret tfvars are never committed. See the migration guide for bootstrap and import prerequisites.

| Package                                                                                    | Purpose                                                                   |
| ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------- |
| `portfolio`                                                                                | Astro static site, content registry, GitHub insights and generated resume |
| `turborepo-remote-cache`                                                                   | Bun cache server, R2 artifacts and Vault runtime configuration            |
| `infra`                                                                                    | OpenTofu infrastructure and read-only build/health adapters               |
| `vault-service`                                                                            | OpenBao runtime image and local Vault auth/read CLI                       |
| `9router`                                                                                  | Local routing app and connector for the OpenTofu-managed tunnel           |
| `workstation`                                                                              | Portable local machine configuration; `ws` dashboard                      |
| `assert`, `logger`, `object-store`, `openrouter`, `secret-store`, `secret-string`, `vault` | Shared libraries                                                          |

The single [CI workflow](.github/workflows/ci.yml) validates, builds images, applies OpenTofu and probes production health. Sibling repositories call its `workflow_call` image publisher and dispatch image revisions back to this repository. OpenTofu manages their publisher files and dispatch secrets.

The generated [llms.txt](llms.txt) explains how other projects integrate with Vault, PostgreSQL, remote caching, object storage and fleet hosting. The portfolio publishes it at [www.chrisvouga.dev/llms.txt](https://www.chrisvouga.dev/llms.txt) with an identical `/llm.txt` alias. Regenerate it with `bun run llms:sync` after changing the infrastructure inventory or integration contract.

Local setup: `vault login`, then `bun run setup` downloads runtime settings without writing infrastructure. `bun run dev` starts the cache server on port 8787. [Workstation setup](packages/workstation/README.md) uses `bun run ws:install`.

After pushing, watch the complete CI run with `bun run gh:ci:watch`; local checks do not validate production deployment.

## Infra health

`bun run health` is the single place to check whether the platform is configured correctly and healthy. It reads the OpenTofu inventory and reports on everything it declares:

| Group       | Checks                                                                                  | Needs             |
| ----------- | --------------------------------------------------------------------------------------- | ----------------- |
| `inventory` | Offline consistency: unique ids and hostnames, dangling references, policy files        | —                 |
| `dns`       | Cloudflare delegation and every declared record                                         | —                 |
| `tls`       | Certificate trust and expiry for every public hostname                                  | —                 |
| `services`  | Each Railway service's health endpoint; Cloudflare redirects                            | —                 |
| `tunnels`   | Cloudflare tunnel connectors (an offline workstation connector warns)                   | —                 |
| `vault`     | Seal state and shares; KV mount, policies, auth roles, users and required KV keys       | Vault token       |
| `storage`   | R2 buckets, Neon, service databases (`SELECT 1`) and the remote cache token             | Vault token       |
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

The [Infra health workflow](.github/workflows/infra-health.yml) runs the full report, including drift, every day and on demand (`gh workflow run infra-health.yml`); its job summary is the same report. `bun run health-check` remains the narrower post-deploy URL probe used inside CI.
