# {{infraRepo}} — LOCAL development infrastructure guide

> **Scope: developer machines only.** Use this guide for everything that runs on or configures a computer used for development: the locked mise toolchain, workstation configuration, the container engine, the `personal` CLI, the Ubuntu developer fleet (one macOS manager, stateless Ubuntu workers), T3, the private fleet AI proxy (CLIProxyAPI), Beszel monitoring, Turborepo caching and disposable test databases. Generated from `scripts/dev/README.md`, `mise.toml`, `packages/workstation/agents/setup.md` and `packages/fleet/docs/ubuntu-sync.md`; tools and dependency graphs are pinned in `mise.lock` and `.mise/locks/`.

**This guide never covers cloud-hosted app infrastructure.** Vault/OpenBao coordinates and policies, PostgreSQL `DATABASE_URL`, the R2 object store, Railway hosting, GHCR images, DNS/TLS, GitHub OIDC and the Google sign-in auth relay are **cloud app infrastructure** → {{cloudGuideUrl}}. If your task is about any of those, stop and use that guide instead. Do not mix the two.

Canonical deployed URL: {{localGuideUrl}} · Index of both guides: {{siteGuideUrl}} · Source snapshot (current `main`): {{localRawUrl}}

## Local vs cloud: the boundary

| Question | Local (this guide) | Cloud (the other guide) |
| --- | --- | --- |
| Where does it run? | A developer's computer or a fleet node | Railway, Cloudflare, managed PostgreSQL, GHCR, GitHub Actions |
| Who owns it? | mise (`mise.toml`, `mise.lock`), `packages/workstation`, `packages/fleet`, `packages/cliproxy-fleet` | OpenTofu in `{{infraRepo}}` only |
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

{{block:agentSetup}}

### Portable developer fleet CLI

`npx --yes @crvouga/personal` opens a searchable terminal command center without
a checkout or Bun. For agents, use `npx --yes @crvouga/personal commands --json`
or `fleet-status --local --json`. Commands are flat and prefixed by domain
(`fleet-*`, `t3-*`, `infra-*`, `workstation`). `infra-*` commands are thin
clients of cloud infrastructure (for example `infra-vault run` reads cloud
Vault); their contracts are in {{cloudGuideUrl}}. Pin an exact published version
in automation. See {{path:packages/personal-cli/README.md}} and
{{path:packages/personal-cli/releasing.md}} for installation, onboarding and CI publishing.

`fleet-status --json` checks the manager and every node in the local,
secret-free roster. Missing rosters and credentials never count as a pass.
Register actual SSH aliases and checkout paths with `fleet-node-add`; preview before
`--apply --yes`. Never copy credentials, accept unknown host keys, or run automatic
repairs. Shared mise/workstation remain the toolchain owners.

---

## Private fleet AI proxy

`@pkgs/cliproxy-fleet` owns the private CLIProxyAPI service and fleet-client bootstrap.
The proxy process runs only on the fleet manager; it is not a hosted app and is never deployed to Railway.
Run `bun run cliproxy help` from this repository. Install only committed revisions;
never patch `/opt/cliproxy-fleet` manually. Source and recovery instructions: {{path:packages/cliproxy-fleet/README.md}}.
The cloud pieces it uses are OpenTofu-owned and out of scope here: its Cloudflare tunnel
hostname, its Vault keys and the encrypted R2 backup of its provider state. The local
install reads them and never creates or changes them.

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

`llms-local.txt` is generated — never edit it by hand. Prose lives in {{path:scripts/llms-local.template.md}}; the embedded runbooks come from {{path:scripts/dev/README.md}}, {{path:mise.toml}}, {{path:packages/workstation/agents/setup.md}} and {{path:packages/fleet/docs/ubuntu-sync.md}} via {{path:scripts/llms-txt.ts}}. Run `{{script:llms:sync}}` after changing any of them; `{{script:check:llms}}` fails CI on drift, on a dangling reference, or when cloud-only content leaks into this guide (see `BOUNDARY` in the generator).

## Ubuntu developer-fleet synchronization (homelab, not cloud infrastructure)

{{block:fleetSync}}
