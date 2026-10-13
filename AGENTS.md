# Agent Notes

## Monorepo

Flat Turborepo + Bun workspace. All packages live under `packages/` and use `@pkgs/*` names. Install at the root with `bun install`.

- `packages/portfolio`: Astro static portfolio, GitHub insights, generated resume PDF. Content lives in `src/content/projects/`; append projects to `entries-part-2.ts`. Build with Node >=22 and Playwright Chromium. Do not commit `dist/` or the generated PDF.
- `packages/turborepo-remote-cache`: Bun cache server backed by the shared R2 buckets. Runtime closure: `@pkgs/{assert,logger,object-store,secret-store,secret-string,vault}`.
- `packages/infra`: OpenTofu definitions and read-only build/health/documentation adapters.
- `packages/self-hosting`: NixOS configurations for physical machines we own (CI runners and web servers); see its `AGENTS.md`. Do not provision cloud resources there.
- `packages/vault-service`: OpenBao runtime image and local read/auth CLI. Its infrastructure, schema, initialization, policies, auth and KV values are owned by OpenTofu.
- `packages/9router`: local CLI and tunnel connector. It consumes OpenTofu-managed secrets and remote tunnel configuration.
- `packages/workstation`: portable local machine configuration. Read its `AGENTS.md` before editing it. Install with `bun run ws:install`; converge local configuration with `ws sync`.

## Hard infrastructure rule

**Infrastructure resources are managed exclusively by OpenTofu**, except physical machines we own, which are defined in `packages/self-hosting` by its pinned NixOS flake. That package must not provision cloud resources. Do not extend the NixOS exception to cloud infrastructure, and do not define self-hosted machines in OpenTofu. Never add provisioning, reconciliation, API mutation, secret seeding, shell provisioners, `local-exec`, `remote-exec`, or alternative IaC controllers elsewhere. Runtime application operations, image builds, secret reads and HTTP probes are not infrastructure provisioning.

Canonical inventory: `packages/infra/tofu/modules/inventory/inventory.tf.json` (`locals.inventory`). Resource definitions: `packages/infra/tofu/{state,foundation,bootstrap,vault,fleet}`. See `packages/infra/tofu/README.md` for ownership, migration and state requirements. Do not introduce a YAML or TypeScript desired-state inventory.

Use `bun run infra[:state|:bootstrap|:vault|:fleet] <OpenTofu command>`. All roots pin providers and encrypt state/plans. Import existing resources before applying; never replace a live database, bucket, tunnel, service, KV mount or seal to adopt it. These resources have `prevent_destroy` guards. Apply a reviewed saved plan. Run Railway provider operations serially (`-parallelism=1`). Never run another provisioning tool or mutate dashboards.

Vault paths: `secret/data/personal/{dev|prd}`. Update secret inputs through the vault OpenTofu root. Never commit tokens, passwords, initialization credentials, state, plans or secret tfvars. The bootstrap state contains unseal material and must remain encrypted and backed up.

Never patch dependencies. Never disable structural size limits in ESLint; refactor instead.

## Validation and CI

`bun run check` installs with the frozen lock, checks formatting, agent links, generated docs, root scripts, OpenTofu fmt/init/validate/tests, then package typecheck/lint/test/build. Install OpenTofu 1.13.0 locally first. `bun run check:ci` adds the Vault dev gates and supplies portfolio build credentials.

`bun run health` is the single read-only report on whether the live platform matches the inventory and is healthy (DNS, TLS, services, tunnels, Vault, storage, images, GitHub, runners); add `--drift` to plan every initialized OpenTofu root. Missing credentials report `SKIP`, never a pass. New infrastructure gets a check in `packages/infra/lib/health/`; checks must stay read-only. The **Infra health** workflow runs it daily with drift.

A green local check is not green CI. If pushing, watch the complete **CI** workflow with `bun run gh:ci:watch` and fix publish/deploy failures before claiming success. `/pr-ready` uses `.agents/commands/pr-ready.md`; PRs to main need `Required`.

## Generated integration guide

Root `llms.txt` is generated; never edit it directly. Edit `scripts/llms-txt.template.md`, the OpenTofu inventory/template, CI inputs or the cache secret registry, then run `bun run llms:sync`. `bun run check:llms` checks drift and dangling references. Hosting requests are `[hosting] <id> — …` issues; add the OpenTofu inventory entry and portfolio content in a PR closing the issue.

Canonical agent commands live in `.agents/commands/*.md`; harness copies are symlinks managed by `bun run agents:sync`. Edit the canonical files.
