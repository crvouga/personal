> **Retired service.** This historical setup prompt is retained for reference. Do not run it or configure new clients. See [README.md](README.md).

# Agent prompt: wire this repo to the self-hosted Turborepo remote cache

Paste everything below the line into an agent session in the **consumer** monorepo (not the cache server repo).

---

## Goal

Configure this repository’s Turborepo so builds use the self-hosted remote cache at **https://turborepo.chrisvouga.dev** (Bearer auth). Do not deploy or modify the cache server. Only change client-side config in this repo (env, CI secrets, `turbo.json` / scripts as needed).

Official Turborepo self-hosted client env vars (see Turborepo remote-cache docs):

```bash
TURBO_API=https://your-cache-server.com
TURBO_TOKEN=your-auth-token
TURBO_TEAM=your-team
```

## Required client environment

Set these everywhere `turbo` runs (local shell / Vault / CI secrets). Values must match across machines and CI.

| Variable      | Required          | Value                                                                                      |
| ------------- | ----------------- | ------------------------------------------------------------------------------------------ |
| `TURBO_API`   | yes               | `https://turborepo.chrisvouga.dev` (no trailing slash)                                     |
| `TURBO_TOKEN` | yes               | Shared Bearer token — **obtain from the human / Vault; never invent or commit**            |
| `TURBO_TEAM`  | yes               | Any non-empty team slug Turbo requires (use `local` unless this repo already uses another) |
| `TURBO_CACHE` | yes (recommended) | `remote:rw`                                                                                |

Optional:

| Variable                   | Suggested                     |
| -------------------------- | ----------------------------- |
| `TURBO_LOG_ORDER`          | `stream` (CI log readability) |
| `TURBO_TELEMETRY_DISABLED` | `1`                           |

### Obtaining `TURBO_TOKEN`

Ask the human for the token, or if they use the same OpenBao as the cache owner:

- Vault KV path: `secret/data/personal/{dev|prd}` key `TURBO_TOKEN`
- Or from the cache monorepo (when available):  
  `vault run --config dev -- <your build command>`
  which reads OpenTofu-managed cache credentials.

**Never commit `TURBO_TOKEN`.** Prefer Vault, GitHub Actions secrets / OIDC→Vault, or a local untracked `.env` that is already gitignored.

## Work to do in this repo

1. **Confirm Turborepo is in use** (`turbo.json`, root scripts that call `turbo run …`). If not, stop and tell the human.
2. **Secrets / env**
   - Local: document or wire exports so developers get the four required vars (e.g. `vault run`, direnv, or project setup script). Example:

     ```bash
     export TURBO_API=https://turborepo.chrisvouga.dev
     export TURBO_TOKEN=<from Vault / human>
     export TURBO_TEAM=local
     export TURBO_CACHE=remote:rw
     ```

   - CI: inject the same vars into jobs that run `turbo`. Prefer existing secret machinery; do not hardcode the token in workflow YAML.
3. **`turbo.json`**
   - Ensure Turbo can see the env vars. If the repo uses `globalPassThroughEnv` / `passThroughEnv` / `globalEnv`, include `TURBO_*` (or the specific keys above) so remote cache auth is not stripped.
   - Do **not** put the token value in `turbo.json`.
4. **Task invocation**
   - Prefer relying on `TURBO_CACHE=remote:rw`, **or** pass `--cache=remote:rw` on CI / shared scripts.
   - Avoid flags that disable remote write unless intentional (`remote:r`, `--no-cache`, etc.).
5. **Do not**
   - Point at Vercel Remote Cache (`turbo login` / `turbo link` to Vercel) for this setup.
   - Change artifact hashing / task `inputs`/`outputs` solely to “force” cache hits.
   - Commit secrets, `.env` with tokens, or paste the token into docs.

## Verify

With the env vars set:

```bash
# Cache server up
curl -fsS https://turborepo.chrisvouga.dev/health

# Auth gate (expect 401 without token)
curl -s -o /dev/null -w "%{http_code}\n" https://turborepo.chrisvouga.dev/v8/artifacts/status

# Auth OK (expect JSON with enabled / status — not 401)
curl -fsS -H "Authorization: Bearer $TURBO_TOKEN" \
  https://turborepo.chrisvouga.dev/v8/artifacts/status

# Real Turbo usage — look for remote cache HIT/MISS in the UI/logs
turbo run build --cache=remote:rw
# second clean-ish run should show remote hits when inputs unchanged
```

If `/health` fails, the cache host is down — stop and report; do not “fix” by switching providers.

## Done when

- [ ] `TURBO_API` / `TURBO_TOKEN` / `TURBO_TEAM` / `TURBO_CACHE` are available locally and in CI without being committed
- [ ] `turbo.json` (or equivalent) passes `TURBO_*` through to tasks
- [ ] `curl` health + authenticated `/v8/artifacts/status` succeed
- [ ] At least one `turbo run … --cache=remote:rw` talks to `https://turborepo.chrisvouga.dev` (HIT or MISS in logs, not a silent local-only run)

## Reference (cache owner repo)

Server lives at `packages/turborepo-remote-cache` in the chrisvouga workspace; client secret registry / seeder: `scripts/vault-secrets-registry.ts`, `bun run seed:turbo-client`. Public origin: `https://turborepo.chrisvouga.dev`.
