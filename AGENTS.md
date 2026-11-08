# Agent Notes

## Single CLI ownership

`personal` (published as `@crvouga/personal`) is the only repository-owned user CLI.
Add domains and commands to `packages/personal-cli`; packages may implement private
adapters/workers but must not declare another executable, installer, launcher or
independent user command interface. Root task scripts are aliases or build/test
and bootstrap tasks, not additional CLI products. Third-party tools retain their
upstream CLIs. Keep command discovery and interactive routing in the shared registry.

## Monorepo

Flat Turborepo + Bun workspace. All packages live under `packages/` and use `@pkgs/*` names. Install at the root with `bun install`.

- `packages/portfolio`: Astro static portfolio, GitHub insights, generated resume PDF. Content lives in `src/content/projects/`; append projects to `entries-part-2.ts`. Build with Node >=22 and Playwright Chromium. Do not commit `dist/` or the generated PDF.
- `packages/turborepo-remote-cache`: Dormant Bun cache server; excluded from hosting and normal development. Runtime closure: `@pkgs/{assert,logger,object-store,secret-store,secret-string,vault}`.
- `packages/infra`: OpenTofu definitions and read-only build/health/documentation adapters.
- `packages/vault-service`: OpenBao runtime image and local read/auth CLI. Its infrastructure, schema, initialization, policies, auth and KV values are owned by OpenTofu.
- `packages/cliproxy-fleet`: private CLIProxyAPI Compose service, reproducible Git-based local installation, fleet clients and encrypted recovery. Read its `AGENTS.md`; never patch installed `/opt` code or add cloud provisioning helpers.
- `packages/9router`: upstream Railway service with ephemeral SQLite restored and replicated to shared R2 using Litestream. No persistent service volume.
- `packages/zoomies`: official Zoomies GitHub Actions runner controller wrapper on Railway (`zoomies.chrisvouga.dev`) with a Railway volume for SQLite and built-in encrypted backups to shared R2; `bun run zoomies:configure` / `zoomies:join-token` drive the running controller's API. Read its `README.md` runbook.
- `packages/workstation`: portable local machine configuration. Read its `AGENTS.md` before editing it. Install with `bun run personal:install`; converge local configuration with `personal workstation sync`.
- `packages/fleet`: canonical developer membership, controller-driven Ubuntu synchronization and diagnostics. Read its `README.md`, `AGENTS.md` and `docs/ubuntu-sync.md` release gates. Public `fleet-sync` targets the enrolled fleet from one controller and applies on invocation without a prompt (`--dry-run` previews); `fleet-status --workers` audits mandatory worker policy and the Beszel dashboard without mutations; `fleet-repair` and `fleet-node-add` preview until `--apply --yes`. Machine policy lives in Workstation Ansible (`ubuntu/`, `macos/`, `monitoring/`) using builtin modules only; Ubuntu is accepted, macOS is best effort, Windows is never converged. Private connection overrides are not cloud inventory. Never copy identities, bypass SSH trust, or install node pull schedules; delegate configuration to Workstation and the shared toolchain.
- `packages/personal-cli`: private source workspace for the public `@crvouga/personal` Node/npm CLI. Read its `README.md`, `AGENTS.md` and `releasing.md`. `bun run personal` prints help; inside the checkout `npx @crvouga/personal` resolves to this working tree (workspace link), not the registry; `--interactive` opts into the command palette. Commands are flat and prefixed by domain (`fleet-*`, `t3-*`, `infra-*`, `workstation`); `commands --json` is the single noninteractive discovery and agent contract. `--version` and help print the release build timestamp. CI publishes only after Check; `personal:publish:bootstrap` is plan-only unless `--apply --yes`. Never publish the workspace or include a roster/credentials.

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

Service runtime logs use `@pkgs/logger` and its [observability contract](packages/logger/README.md): correlated HTTP requests, named dependency operations, safe structured error causes, lifecycle events and background-job outcomes. New services must expose read-only dependency readiness and keep credentials, SQL parameters and OAuth payloads out of logs. Third-party runtimes use native structured logs; infrastructure for collection/alerts remains OpenTofu-owned.

`bun run check` installs with the frozen lock, checks formatting, agent links, generated docs, root scripts, OpenTofu fmt/init/validate/tests, then package typecheck/lint/test/build. Install OpenTofu 1.13.0 locally first. `bun run check:ci` adds the Vault dev gates and supplies portfolio build credentials.

`bun run health` is the single read-only report on whether the live platform matches the inventory and is healthy (DNS, TLS, services, tunnels, Vault, storage, images, GitHub, runners); add `--drift` to plan every initialized OpenTofu root. Missing credentials report `SKIP`, never a pass. New infrastructure gets a check in `packages/infra/lib/health/`; checks must stay read-only. The **Maintenance / Health** job runs it daily with drift. `bun run health:fix` is its interactive counterpart: it runs the same checks, then walks each failure with a confirmed guided fixer (always through OpenTofu or CI, never a provider API) or a manual pointer. Add a fixer or advice in `scripts/health-fix/registry.ts` when adding a check.

A green local check is not green CI. If pushing, watch the complete **CI** workflow with `bun run gh:ci:watch` and fix publish/deploy failures before claiming success. `/pr-ready` uses `.agents/commands/pr-ready.md`; PRs to main require `Check`. The legacy `Fleet` and `Required` status aliases remain until the OpenTofu-owned ruleset migration is verified live; see `packages/infra/docs/application-decommission.md`.

## Generated integration guide

Root `llms.txt` is generated; never edit it directly. Edit `scripts/llms-txt.template.md`, the OpenTofu inventory/template, CI inputs or the cache secret registry, then run `bun run llms:sync`. `bun run check:llms` checks drift and dangling references. Hosting requests are `[hosting] <id> — …` issues; add the OpenTofu inventory entry and portfolio content in a PR closing the issue.

Canonical agent commands live in `.agents/commands/*.md`; harness copies are symlinks managed by `bun run agents:sync`. Edit the canonical files.
