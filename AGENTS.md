# Agent Notes

## Pull requests (read first)

All code is written by agents and merged by CI; nobody reviews it. CI is the only gate.

- Only pick up issues labeled `ready`. One task = one small PR.
- Branch from fresh `main`: `git fetch origin && git switch -c agent/<task>-<slug> origin/main` (T3 worktrees use `t3/*`; both count as agent branches). Never push to `main`.
- Open the PR as a draft, run `bun run check` until it passes, then mark it ready. Marking an agent PR ready turns on squash auto-merge, so it merges by itself once `Check` passes (`gh pr merge --auto --squash` does the same by hand).
- Title: Conventional Commit (`feat(scope): …`, commitlint enforces it). The PR body becomes the squash commit body; fill in `.github/pull_request_template.md`.
- Breaking changes are fine: there is one user and one deployed version. Delete old code; no compatibility shims, flags or migrations for old callers.
- Never weaken a check to go green. Fix the code, or add the `needs-human` label and explain why in the PR body.
- Do not bump dependencies; Dependabot owns that (`deps` label).
- `needs-human` and `do-not-merge` turn off auto-merge; a human merges or closes the PR.
- **Failures on `main` become issues.** Any failing job on `main` (CI, Deploy, Maintenance, Developer toolchain, Agent PRs, Drift) opens one issue per job, `<workflow>: <job> failing on main`, labeled `ci-failed` and `ready`, with `file:line`, the repro command, a log excerpt and a JSON block. Fix it like any task and put `Fixes #<n>` in the PR body; the issue also closes itself when that job next passes on `main` (`.github/workflows/failure-issues.yml`).
- **When CI fails**, read the PR's sticky "CI report" comment: each failure lists `file:line`, a `Reproduce:` command and a JSON block (`failures[].job`, `.command`, `.locations`). Reproduce locally, fix, push. After 3 failing commits the PR is labeled `needs-human`.
- Idle agent PRs are labeled `stale` after 2 days and closed after 5. Branches behind `main` are updated hourly; a conflict labels `needs-human` and lists the files.

## Single CLI ownership

`personal` (`packages/personal-cli`) is the only repository-owned user CLI. It is
source-only (not published) and holds `infra-*` passthroughs, `workstation` and
`commands`. Packages may implement private adapters/workers but must not declare
another executable, installer, launcher or independent user command interface.
Root task scripts are aliases or build/test and bootstrap tasks, not additional
CLI products. Third-party tools, including dev-fleet, retain their own CLIs.

## The fleet runs from dev-fleet

All fleet management (machines, Ansible policy, agent launchers, T3 provider instances, monitoring and the CLI proxy) lives in [crvouga/dev-fleet](https://github.com/crvouga/dev-fleet). This repository holds only this fleet's configuration, `fleet.json`, and the pinned dev-fleet commit, `fleet.revision`. `scripts/dev/fleet.sh` runs any dev-fleet command at that pin with this `fleet.json`; everything below goes through it. The **CLI proxy health** workflow runs dev-fleet's proxy checks at the pin.

| Task                                       | Root script               | T3 project action (`bash scripts/dev/project-action.sh …`) |
| ------------------------------------------ | ------------------------- | ---------------------------------------------------------- |
| Preview a sync (`fleet-sync --dry-run`)    | `bun run fleet:preview`   | `fleet-preview`                                            |
| Converge the manager and every worker      | `bun run fleet:sync`      | `fleet-sync`                                               |
| Read-only audit of every worker            | `bun run fleet:status`    | `fleet-status`                                             |
| Workers, T3 providers and (manager) proxy  | `bun run fleet:health`    | `fleet-health`                                             |
| Preview repairs (`--apply --yes` executes) | `bun run fleet:repair`    | `fleet-repair`                                             |
| T3 provider drift on this machine          | `bun run fleet:t3`        | `fleet-t3-status`                                          |
| The CLI proxy's operations                 | `bun run cliproxy <op>`   | `infra-cliproxy <op>`                                      |
| Any other dev-fleet command                | `bun run fleet <command>` |                                                            |
| The command catalog and agent contract     | `bun run fleet:commands`  |                                                            |

- Read `bun run fleet:commands` before using a dev-fleet command. `fleet-sync`, `fleet-node-sync`, `t3-apply` and `t3-cleanup` apply when invoked; only `--dry-run` previews. `--json` does not make a command read-only. The preview is not free of side effects on the manager either: it installs the pinned revision's toolchain there first ([dev-fleet#18](https://github.com/crvouga/dev-fleet/issues/18)), so preview a new `fleet.revision` only when you mean to move the manager to it.
- `fleet-sync` runs on the manager; started on a worker it hands off to the manager over SSH. Every other command needs the checkout of the pinned revision that `fleet-sync` leaves on the machine.
- Change fleet behaviour in dev-fleet, then bump `fleet.revision`. Change this fleet's machines, endpoints or secret locations in `fleet.json`.
- **Never edit dev-fleet itself**: not `node_modules`, not a clone, not a checkout or file it installs on a machine; the next install or `fleet-sync` replaces them. Do not work around a dev-fleet defect here either. A bug in dev-fleet or a feature it lacks is a GitHub issue at https://github.com/crvouga/dev-fleet/issues (one per defect, after searching the open ones); tell the user what is blocked and link it. Issues are public: no credentials, hostnames, accounts, domains, tailnet names, home-directory paths, raw subprocess output or `fleet.json` contents. Include the dev-fleet version or commit, the command and flags, the failing check IDs and what was expected.
- Never add fleet code back here. `packages/workstation` uses dev-fleet's platform and agent modules through the published `@crvouga/dev-fleet` npm package.
- On a fleet machine the global mise configuration belongs to dev-fleet: `scripts/dev/setup.ts` installs this checkout's tools and leaves a global config that carries dev-fleet's marker unchanged. Fleet actions never run this repository's bootstrap.
- dev-fleet documents a different pin: the `@crvouga/dev-fleet` version in `package.json`, run as `npx devfleet`, with the fleet state in a bucket named under `state` in `fleet.json`. No published release supports that yet ([dev-fleet#17](https://github.com/crvouga/dev-fleet/issues/17)). When one does, replace `fleet.revision` and the clone in `scripts/dev/fleet.sh` with that dependency; the bucket is a cloud resource and goes through OpenTofu first.

## Local development infra vs cloud app infra

These are two separate domains. Never mix their commands, owners, credentials or docs.

- **Local development infrastructure**: developer machines. mise toolchain, `packages/workstation`, the fleet (manager + Ubuntu workers), T3, the CLI proxy, Beszel agents, local Turborepo cache, disposable test containers. Owned by `mise.toml`/`mise.lock`, `packages/workstation` and dev-fleet (`fleet.json`, `fleet.revision`). Agent guide: `llms-local.txt` (`scripts/llms-local.template.md`).
- **Cloud app infrastructure**: OpenTofu resources apps use. Vault/OpenBao, PostgreSQL, R2, Railway services, GHCR images, DNS/TLS/tunnels, GitHub OIDC/rulesets, auth relay. Owned only by `packages/infra/tofu` (`bun run infra*`). Agent guide: `llms-cloud.txt` (`scripts/llms-cloud.template.md`).

- `dev` is not local: the Vault `dev` config, `dev` bucket and `dev` `DATABASE_URL` are cloud resources.
- Machines read cloud credentials (Vault login, R2 backups) but never create or change cloud resources. OpenTofu never configures a machine. A developer machine is never a hosting target.
- A task that touches both is two tasks: do each half with its own owner and guide.

## Monorepo

Flat Turborepo + Bun workspace. All packages live under `packages/` and use `@pkgs/*` names. Install at the root with `bun install`.

- `packages/portfolio`: Astro static portfolio, GitHub insights, generated resume PDF. Everything is a function of two knowledge bases: personal facts in `src/knowledge/` (append projects to `projects.ts` there, screenshots to `src/content/projects/media.ts`) and the market in `src/market/` (the measured landscape plus cited market research). Each job role is one file in `src/roles/by-id/` (`bun run roles:new` scaffolds one, `roles:sync` regenerates what follows); its presentation (`/a/<id>/`, indexed at `/roles/`), theme and résumé are derived, and the unlisted `/gaps/` page grades the facts against the market. Use `/portfolio-refresh` after market or knowledge changes. **All portfolio UI development goes through Storybook** (`bun run storybook`; deployed at `/storybook/`): build and review components and screens there before they reach a page; they read only design-system tokens (`src/design-system/`), each role has its own theme, and every component and screen has stories in every role × scheme (`src/stories/variants.ts`). **Every PR that changes portfolio UI posts Storybook screenshots** before review: `bun run storybook:build && bun run storybook:screenshots && bun run storybook:pr-comment <pr>`. Build with Node >=22 and Playwright Chromium. Do not commit `dist/` or the generated PDF.
- `packages/turborepo-remote-cache`: Dormant Bun cache server; excluded from hosting and normal development. Runtime closure: `@pkgs/{assert,logger,object-store,secret-store,secret-string,vault}`.
- `packages/infra`: OpenTofu definitions and read-only build/health/documentation adapters.
- `packages/vault-service`: OpenBao runtime image and local read/auth CLI. Its infrastructure, schema, initialization, policies, auth and KV values are owned by OpenTofu.
- `packages/9router`: upstream Railway service with ephemeral SQLite restored and replicated to shared R2 using Litestream. No persistent service volume.
- `packages/zoomies`: official Zoomies GitHub Actions runner controller wrapper on Railway (`zoomies.chrisvouga.dev`) with a Railway volume for SQLite and built-in encrypted backups to shared R2; `bun run zoomies:configure` / `zoomies:join-token` drive the running controller's API. Read its `README.md` runbook.
- `packages/workstation`: one person's portable dev-machine configuration (OpenCode, notifier, sounds, SSH/editor network setup). It imports platform and agent modules from the `@crvouga/dev-fleet` npm package and reads machines from `fleet.json`. Read its `AGENTS.md` before editing it. Install with `bun run personal:install`; converge local configuration with `personal workstation sync`.
- `packages/personal-cli`: the source-only `personal` CLI (`infra-*`, `workstation`, `commands`). Read its `README.md` and `AGENTS.md`. `bun run personal` prints help; `commands --json` is the agent catalog. It has no fleet or T3 commands; dev-fleet supersedes them.

## Shared authentication relay

`packages/auth-relay` contains the staged shared Google-to-OIDC broker and same-domain Bun/Hono management UI. Read its `README.md`, `operations.md` and `acceptance.md` before integrating or deploying. Applications use standard OIDC code + S256 PKCE with independent sessions and need no Google credentials. Authorized operators register exact callbacks in the Google-protected UI and can delegate scoped agent registration through **Agent access**. Agents use `/agent/v1/clients` with credentials from isolated Vault `secret/auth-relay-agents/<credential-id>/<config>` documents; the standalone `packages/auth-relay/agent.ts` client needs no workspace imports. Application registrations, agent grants and callback configuration live only in isolated PostgreSQL schemas (`auth_relay_production` / `auth_relay_nonproduction`), never project allowlists in code or inventory. Atlas manages those schemas through OpenTofu. Runtime client registration is application data; hosting, roles, schema, bootstrap system identities and secrets remain OpenTofu-owned. Never use wildcard redirects or the native-app loopback exception for web clients. The relay is preproduction until its documented live and reliability gates pass. Default `dev` loads managed credentials through Vault and fails clearly until the staged relay is deployed and reachable; it never falls back to mocks. Explicit `dev:fixtures` / `AUTH_DEV_MODE=local` prepares a loopback-only mock identity/database stack through `auth-development`, not live Google validation.

## Source ownership

All authored code must live in this repository. Run deployed services and client launchers from Git-tracked files (pinned deployment worktrees are allowed); do not leave standalone executable copies or generated executable wrappers elsewhere on a machine. Keep secrets/runtime data separate in Vault and encrypted cloud backups.

## Hard infrastructure rule

**Infrastructure resources are managed exclusively by OpenTofu**. Local developer tools and user configuration are managed by the shared mise toolchain (`mise.toml`, `mise.lock`, `scripts/dev/README.md`) and `packages/workstation`; this does not authorize cloud provisioning. Never add provisioning, reconciliation, API mutation, secret seeding, shell provisioners, `local-exec`, `remote-exec`, or alternative IaC controllers elsewhere. Runtime application operations, image builds, secret reads and HTTP probes are not infrastructure provisioning.

Canonical inventory: `packages/infra/tofu/modules/inventory/inventory.tf.json` (`locals.inventory`). Resource definitions: `packages/infra/tofu/{state,foundation,bootstrap,vault,services}`. See `packages/infra/tofu/README.md` for ownership, migration and state requirements. Do not introduce a YAML or TypeScript desired-state inventory.

Use `bun run infra[:state|:bootstrap|:vault|:services] <OpenTofu command>`. All roots pin providers and encrypt state/plans. Import existing resources before applying; never replace a live database, bucket, tunnel, service, KV mount or seal to adopt it. These resources have `prevent_destroy` guards. Apply a reviewed saved plan. Run Railway provider operations serially (`-parallelism=1`). Never run another provisioning tool or mutate dashboards.

Vault paths: `secret/data/personal/{dev|prd}`. Update secret inputs through the vault OpenTofu root. Never commit tokens, passwords, initialization credentials, state, plans or secret tfvars. The bootstrap state contains unseal material and must remain encrypted and backed up.

External application repositories own their schemas, migrations, publisher workflows and validation. Keep this platform coupled only through generic hosting inventory, secret metadata, reusable workflows and repository policy; never add application-name conditionals or application table DDL here.

Never patch dependencies. Never disable structural size limits in ESLint; refactor instead.

## Validation and CI

Service runtime logs use `@pkgs/logger` and its [observability contract](packages/logger/README.md): correlated HTTP requests, named dependency operations, safe structured error causes, lifecycle events and background-job outcomes. New services must expose read-only dependency readiness and keep credentials, SQL parameters and OAuth payloads out of logs. Third-party runtimes use native structured logs. All projects share one OpenTofu-owned Grafana Cloud stack that receives OpenTelemetry through the standard `OTEL_EXPORTER_OTLP_*` variables in Vault (injected into every Railway service); `@pkgs/logger` exports to it automatically, and agents query it with the read-only `GRAFANA_SERVICE_ACCOUNT_TOKEN`. See the Observability section of `llms-cloud.txt`.

`bun run check` installs with the frozen lock, checks formatting, agent links, generated docs, root scripts, OpenTofu fmt/init/validate/tests, then package typecheck/lint/test/build. Install OpenTofu 1.13.0 locally first. `bun run check:ci` adds the Vault dev gates and supplies portfolio build credentials.

`bun run health` is the single read-only report on whether the live platform matches the inventory and is healthy (DNS, TLS, services, tunnels, Vault, storage, images, GitHub, runners); add `--drift` to plan every initialized OpenTofu root. Missing credentials report `SKIP`, never a pass. New infrastructure gets a check in `packages/infra/lib/health/`; checks must stay read-only. The **Maintenance / Health** job runs it daily with drift. `bun run health:fix` is its interactive counterpart: it runs the same checks, then walks each failure with a confirmed guided fixer (always through OpenTofu or CI, never a provider API) or a manual pointer. Add a fixer or advice in `scripts/health-fix/registry.ts` when adding a check.

A green local check is not green CI. If pushing, watch the complete **CI** workflow with `bun run gh:ci:watch` and fix publish/deploy failures before claiming success. `/pr-ready` uses `.agents/commands/pr-ready.md`. PRs to `main` require `Check` (fast lanes). Slow lanes (auth compatibility, cross-OS CLI, public URLs) run only on `main`, merge-queue and manual runs as **Slow checks**; deploy and release wait for them. Every local `bun run check` step has a CI lane; `scripts/ci-check-parity.test.ts` fails if they diverge.

## Generated agent guides

Root `llms.txt` (index), `llms-local.txt` and `llms-cloud.txt` are generated by `scripts/llms-txt.ts`; never edit them directly. Edit `scripts/llms-txt.template.md` (index only, no instructions), `scripts/llms-local.template.md` (machines/fleet), `scripts/llms-cloud.template.md` (cloud resources), or their sources (OpenTofu inventory, CI inputs, the cache secret registry, `scripts/dev/README.md`, `mise.toml`, fleet docs), then run `bun run llms:sync`. `bun run check:llms` checks drift, dangling references and the `BOUNDARY` markers that stop either guide from containing the other's content. Hosting requests are `[hosting] <id> — …` issues; add the OpenTofu inventory entry and portfolio content in a PR closing the issue.

Canonical agent commands live in `.agents/commands/*.md`; harness copies are symlinks managed by `bun run agents:sync`. Edit the canonical files.
