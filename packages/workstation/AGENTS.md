# Workstation agent notes

- `packages/workstation/README.md` is the canonical context for this area — read it before modifying workstation configuration.
- Inspect existing monorepo conventions (root `README.md`, root `AGENTS.md`) before introducing new mechanisms.
- Keep `packages/workstation/README.md` current whenever supported tools, structure, setup behavior, or conventions materially change.
- Keep workstation tooling simple; reuse existing workspace packages where appropriate; do not scaffold speculative infrastructure.
- `personal` is the only public executable. This package is an internal owner exposed through `personal workstation`; do not restore a `ws` bin or launcher. `bun run personal:install` installs the source-owned public launcher and migrates only owned legacy launchers. Fleet machine policy, agent launchers/profiles, monitoring and T3 provider reconciliation live in `packages/fleet`; this package may import fleet, never the reverse.
- Platform-specific behavior lives behind the `Platform` interface (`packages/fleet/src/platform/`); commands never branch on `process.platform` directly — add/extend an adapter instead.
- OpenCode provider config is sourced from Vault via `@pkgs/secret-store`'s `SecretStoreEntry`; see `opencode/provider-secrets.ts` (catalog) and `cli/lib/providers-sync.ts` (sync logic, shared by `personal workstation opencode sync` and `opencode/configure-providers.ts`). The generated `~/.config/opencode/opencode.json` embeds keys (0600) and is never committed.
- OpenCode defaults to the **OpenRouter Auto Router** when the `openrouter` key is present. The Auto Router model is owned by `@pkgs/openrouter` (`packages/openrouter/`, `auto-router.ts`); the sync registers `openrouter/auto` and sets `model`/`small_model` to it. Never configure the Auto Router in the OpenRouter web UI — set the cost tier / model filters in `@pkgs/openrouter`.
- Never commit secrets.
