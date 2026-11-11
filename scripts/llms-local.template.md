# {{infraRepo}} — LOCAL development infrastructure guide

> **Scope: developer machines only.** Use this guide for everything that runs on or configures a computer used for development: the locked mise toolchain, workstation configuration, the container engine, the `personal` CLI, the Ubuntu developer fleet (one macOS manager, stateless Ubuntu workers), T3, the private fleet AI proxy (CLIProxyAPI), Beszel monitoring, Turborepo caching and disposable test databases. Generated from `scripts/dev/README.md` and `mise.toml`; tools and dependency graphs are pinned in `mise.lock` and `.mise/locks/`.

**This guide never covers cloud-hosted app infrastructure.** Vault/OpenBao coordinates and policies, PostgreSQL `DATABASE_URL`, the R2 object store, Railway hosting, GHCR images, DNS/TLS, GitHub OIDC and the Google sign-in auth relay are **cloud app infrastructure** → {{cloudGuideUrl}}. If your task is about any of those, stop and use that guide instead. Do not mix the two.

Canonical deployed URL: {{localGuideUrl}} · Index of both guides: {{siteGuideUrl}} · Source snapshot (current `main`): {{localRawUrl}}

## Local vs cloud: the boundary

| Question | Local (this guide) | Cloud (the other guide) |
| --- | --- | --- |
| Where does it run? | A developer's computer or a fleet node | Railway, Cloudflare, managed PostgreSQL, GHCR, GitHub Actions |
| Who owns it? | mise (`mise.toml`, `mise.lock`), `packages/workstation`, [dev-fleet](https://github.com/crvouga/dev-fleet) with this repository's `fleet.json` | OpenTofu in `{{infraRepo}}` only |
| How is it changed? | The documented local commands below, when the user asks for machine setup | A GitHub issue on `{{infraRepo}}`, then a reviewed OpenTofu PR |

Rules:

- **Nothing here provisions or changes a cloud resource.** Machine setup, `fleet-sync`, workstation sync and the AI proxy never create, deploy or reconfigure Vault, databases, buckets, DNS or Railway services. If a local task seems to need one, it is a cloud request: use {{cloudGuideUrl}}.
- **Machines consume cloud credentials; they do not own them.** A fleet node's Vault login, the AI proxy's encrypted R2 backup and its recovery keys in Vault are reads from cloud infrastructure. The Vault server, its policies, tokens and buckets stay OpenTofu-owned and are documented only in the cloud guide.
- **`dev` does not mean local.** The Vault `dev` config, the `dev` bucket and the `dev` `DATABASE_URL` are cloud resources. "Local" in this guide means *runs on this computer*.
- **A developer machine is never a hosting target**, and a fleet node is never an app server. Apps are hosted only through the cloud guide.
- **Global tooling changes only on request.** When the user asks for machine setup, run the checked-in bootstrap and locked mise toolchain. Otherwise report missing tools with the documented command; do not make unrelated global changes.

---

{{block:workstation}}

### Exact shared tool versions (generated from mise.toml)

{{block:workstationTools}}

### The `personal` CLI

`bun run personal` runs from the checkout. Commands are flat and prefixed by
domain: `infra-*` commands are thin clients of cloud infrastructure (for example
`infra-vault run` reads cloud Vault; their contracts are in {{cloudGuideUrl}}),
and `workstation` configures this machine. `bun run personal commands --json` is
the agent catalog. See {{path:packages/personal-cli/README.md}}.

---

## Developer fleet and private AI proxy (dev-fleet)

The fleet (one macOS manager, stateless Ubuntu workers), T3 provider instances,
Beszel monitoring and the private CLIProxyAPI service are managed by
[dev-fleet](https://github.com/crvouga/dev-fleet); none of that code lives here.
This repository holds only this fleet's configuration, {{path:fleet.json}}, and the
dev-fleet commit it runs, {{path:fleet.revision}}. From the checkout:

```sh
bun run fleet:preview        # fleet-sync --dry-run: what a sync would change
bun run fleet:sync           # converge the manager and every worker
bun run fleet:health         # read-only: workers, T3 providers and, on the manager, the proxy
bun run fleet:repair         # preview repairs; --apply --yes executes them
bun run fleet <command>      # any other dev-fleet command, for example t3-apply --dry-run
bun run fleet:commands       # the command catalog and agent contract
bun run cliproxy help        # the proxy's operations
```

The same commands are T3 project actions (`bash scripts/dev/project-action.sh
fleet-preview | fleet-sync | fleet-status | fleet-health | fleet-repair |
fleet-t3-status`). `fleet-sync` runs on the manager; started on a worker it hands
off to the manager over SSH. `fleet-sync`, `fleet-node-sync`, `t3-apply` and
`t3-cleanup` apply when invoked: only `--dry-run` previews.

Never edit dev-fleet, a checkout it owns or a file it manages on a machine. A
defect or a missing feature is an issue at
https://github.com/crvouga/dev-fleet/issues, without credentials, hostnames,
accounts, domains or `fleet.json` contents.

Change fleet behaviour in dev-fleet, then bump `fleet.revision`. Change machines,
endpoints or secret locations in `fleet.json`. The proxy runs only on the fleet
manager; it is not a hosted app and is never deployed to Railway. The cloud pieces
it uses (its Cloudflare tunnel hostname, its Vault keys and the encrypted R2 backup
of its provider state) are OpenTofu-owned and out of scope here: the fleet reads
them and never creates or changes them.

---

## Turborepo caching (local only)

Turborepo remote caching is retired. The server source remains dormant at {{path:packages/turborepo-remote-cache}}. Do not configure clients, copy cache credentials or probe the former Turbo endpoint.

Use local caching; remove `TURBO_API`, `TURBO_TOKEN` and `TURBO_TEAM` from client environments. Replace any `TURBO_CACHE=remote:rw` setting with `TURBO_CACHE=local:rw`. In `turbo.json`, set:

```json
{ "remoteCache": { "enabled": false } }
```

GitHub Actions may continue persisting `.turbo` through `actions/cache`.

---

## Disposable databases and mock services for tests

- Unit and repository tests use an isolated, disposable PostgreSQL (or other database) container started by the project's own scripts on the developer machine or CI runner. Containers come from the container engine in machine setup above. Throw them away after the run.
- A disposable test database is never the cloud `dev` database, and its connection string is never stored in Vault. Do not point tests at the cloud `DATABASE_URL`; that is governed by the cloud guide.
- Loopback mock identity stacks (for example `AUTH_DEV_MODE=local` / `dev:fixtures` in `packages/auth-relay`) are local test fixtures, not the auth relay. Real sign-in uses the cloud relay.

---

## Maintaining this file (agents working inside `{{infraRepo}}`)

`llms-local.txt` is generated — never edit it by hand. Prose lives in {{path:scripts/llms-local.template.md}}; the embedded runbooks come from {{path:scripts/dev/README.md}} and {{path:mise.toml}} via {{path:scripts/llms-txt.ts}}. Run `{{script:llms:sync}}` after changing any of them; `{{script:check:llms}}` fails CI on drift, on a dangling reference, or when cloud-only content leaks into this guide (see `BOUNDARY` in the generator).
