# {{infraRepo}} — shared infrastructure integration guide

> The one file an agent needs to integrate another codebase with the shared infrastructure owned by `{{infraRepo}}`: Vault (OpenBao) secrets, PostgreSQL access, the shared Cloudflare R2 object store, Google sign-in through the auth relay, and hosting on the managed Railway services — every hosted project is **Dockerized and ships as a prebuilt GHCR image**. Values in this file are generated from `packages/infra/tofu/modules/inventory/inventory.tf.json`, `.github/workflows/publish.yml` and `.github/workflows/deploy.yml` and the Vault secret registry; CI fails whenever it drifts from them.

Canonical deployed URL: {{siteGuideUrl}} (the site's own `/llms.txt` is the candidate summary for recruiters and links here)

Source snapshot (always current `main`): {{rawUrl}}

## Use this file

- Link it from your project's `AGENTS.md` / `CLAUDE.md` so every session can fetch it:

  ```md
  Shared infra (Vault, PostgreSQL, R2 object store, hosting, Google sign-in):
  {{siteGuideUrl}}
  ```

- Re-fetch it instead of trusting a cached copy — ports, hostnames and the services list change.
- Pick the sections that apply (checklist below); each one is self-contained.
- If anything here disagrees with `OpenTofu inventory` in `{{infraRepo}}`, the OpenTofu definition wins — tell the human the file is stale.

## Ground rules

- **Never invent, print, log, or commit secret values.** If an optional secret is missing or invalid, report its key and source, skip only its dependent integration or skill check, and continue unrelated work. Required credentials for an active deployment fail that deployment; never claim a skipped check passed.
- **Never install global tooling yourself** (`vault`, `bao`, `jq`, `gh`). Tell the human the install command.
- **Shared infrastructure changes belong in `{{infraRepo}}` through OpenTofu** (deployments, secrets, policies, hosting, databases and buckets). A scoped auth-relay registration is an authorized runtime operation: agents may use §6 to manage their own application clients without an infrastructure deployment. Never use provider dashboards or administration APIs.
- `@pkgs/*` packages in `{{infraRepo}}` are **private workspace packages** — they cannot be installed elsewhere. Use the plain HTTP / S3 / env-var contracts below.
- Keep the app **twelve-factor**: configuration and secrets come from env vars at runtime, never from files baked into the image or the repo.

## Integration checklist

1. Needs secrets (API keys, database URLs)? → [1. Vault](#1-vault-secrets). Every other section depends on it.
2. Needs relational data? → [2. PostgreSQL](#2-postgresql). Use only the `DATABASE_URL` contract; the platform database credentials are not an app interface.
3. Uses Turborepo (`turbo.json` exists)? → [3. Local Turborepo caching](#3-local-turborepo-caching).
4. Stores files / blobs? → [4. Object store](#4-object-store-cloudflare-r2-s3-compatible).
5. Should be publicly hosted at `*.{{zone}}` (and listed on the portfolio)? → [5. Hosting](#5-hosting-on-the-managed-services). The project must be Dockerized and publish prebuilt images; you request hosting by opening a GitHub issue on `{{infraRepo}}` (§5 Step 1) that carries everything needed to deploy it and list it on the portfolio.
6. Needs Google sign-in? → [6. Auth relay](#6-auth-relay-google-sign-in). Use public OIDC settings; register with a scoped Vault credential, never Google or relay administrator credentials.

## Resources at a glance

{{block:resources}}

All consumer credentials live in Vault. Auth agent credentials use isolated `{{kvMount}}/auth-relay-agents/<credential-id>/<config>` documents, outside the shared personal document and shared CI read policy. Vault supplies application secrets; application users authenticate through the shared Google-to-OIDC relay, never through Vault.

This is a consumer guide, not an inventory dump. State backends, provider credentials, the OpenBao storage database, administrative tunnels, and control-plane tokens are intentionally excluded from consumer instructions. They remain OpenTofu-owned and must never be reused by an application.

All 14 domain registrations remain at Squarespace; registrar/DNS consolidation is cancelled. Existing Cloudflare DNS for `chrisvouga.dev`, `gamezilla.app`, `moviefinder.app` and `normalizer.app` is preserved. `bun domains inventory` and `bun domains discover` are read-only. Consumers must not transfer registrations or change shared nameservers. Cancellation evidence and the accepted disabled DNSSEC setting for unused `emulates.dev` are documented in {{path:packages/infra/docs/domain-migration.md}}.

---

## 1. Vault (secrets)

**Coordinates**

| Thing   | Value                                                                                    |
| ------- | ---------------------------------------------------------------------------------------- |
| Address | `{{vaultAddr}}` (OpenBao; Vault-compatible API + CLI)                                    |
| Engine  | KV v2 mounted at `{{kvMount}}/`                                                          |
| Path    | `{{kvMount}}/<project>/<config>` (HTTP API: `{{kvMount}}/data/<project>/<config>`)       |
| Project | `{{kvProject}}` — shared by all personal apps; use it unless told otherwise              |
| Configs | {{kvConfigs}} — `dev` for local work, `prd` for CI / production (same key names in both) |

Each KV field becomes one env var. Every config must carry the **same key names** (values may differ). CI read access covers only {{ciReadPaths}} — a new project namespace needs a policy change in `{{infraRepo}}`, so add your app's keys under `{{kvProject}}`.

### Keys that already exist

Reuse these instead of creating duplicates. Adding a key means a human updates the OpenTofu vault root secrets input **and** adds its name to `vault.kv_keys` in the OpenTofu inventory.

{{block:kvKeys}}

### Local dev — `vault run`

The human installs the wrapper once per machine (from a `{{infraRepo}}` checkout; needs the `vault` or `bao` CLI and `jq`):

```bash
{{file:packages/vault-service/scripts/install-cli.sh}}   # → ~/.local/bin/vault wrapper
vault login --method=userpass username={{adminUser}}
```

In your project, commit a `.vault.yaml` (coordinates only, no secrets — safe to commit). `vault setup --project {{kvProject}} --config dev` writes it:

```yaml
{{block:vaultYaml}}
```

Then wrap commands:

```bash
vault run -- bun run dev                  # injects every field as env vars
vault run --config prd -- <cmd>           # override config
vault run --dry-run -- <cmd>              # list injected var names only
vault kv get {{kvMount}}/{{kvProject}}/dev          # inspect (human only)
bun run infra:vault plan  # update the OpenTofu secrets input, then review/apply
```

Put `vault run -- …` inside `package.json` scripts rather than asking developers to export variables. List the needed env var **names** (never values) in `.env.example`, and gitignore `.env*` except `.env.example`.

### CI (GitHub Actions) — OIDC, no stored token

Repos under `{{githubOrg}}/*` mint a short-lived Vault token via GitHub OIDC. Never add a `VAULT_TOKEN` repository secret for CI.

```yaml
{{block:oidcExample}}
```

- JWT auth at `{{jwtPath}}/`, role `{{jwtRole}}` → policy `{{jwtPolicy}}`, TTL {{jwtTtl}}.
- Repository claims restrict access to `{{githubOrg}}/*`. {{jwtRefBinding}} Never substitute a stored `VAULT_TOKEN` for OIDC.
- Vault restarts **sealed** and auto-unseals on deploy. If calls return 503, poll `GET {{vaultAddr}}/v1/sys/health?standbyok=true` until 200 before failing — {{path:.github/actions/vault-secrets/action.yml}} is a wait + retry pattern to copy.
- A repo outside `{{githubOrg}}/*` or a project outside `{{kvProject}}` needs {{path:packages/infra/tofu/vault/main.tf}} / a policy change — tell the human.

### App runtime — read token + HTTP

Processes that cannot be wrapped in `vault run` (servers loading secrets at boot, Workers) use a long-lived read-only token supplied as the platform secret `VAULT_TOKEN` (policy `{{runtimeTokenPolicy}}`, period {{runtimeTokenPeriod}}; the human mints it). Pass `VAULT_ADDR={{vaultAddr}}`, `VAULT_PROJECT={{kvProject}}`, `VAULT_CONFIG=prd` as plain env.

```ts
const res = await fetch(
  `${VAULT_ADDR}/v1/{{kvMount}}/data/${VAULT_PROJECT}/${VAULT_CONFIG}`,
  { headers: { 'X-Vault-Token': VAULT_TOKEN } }
);
if (!res.ok) throw new Error(`vault ${res.status}`); // 503 = sealed → retry with backoff
const secrets = (await res.json()).data.data as Record<string, string>;
```

Honor `Retry-After` on 429 and cache the result for the process lifetime. **Apps hosted on the services do not need this** — declare `secrets:` in `OpenTofu inventory` (§5) and they arrive as plain env vars.

---

## 2. PostgreSQL

The application database contract is the secret env var `{{databaseSecret}}` in Vault `{{kvMount}}/{{kvProject}}/{dev,prd}`. Treat the entire connection string as opaque: pass it unchanged to a PostgreSQL driver, do not parse or reconstruct it, and never print it. The URL selects the environment; do not hardcode a hostname, database, role, password, TLS mode, or provider.

### Boundaries

- `{{databaseSecret}}` is the only application-facing PostgreSQL credential. `{{platformDatabaseSecret}}`, `PLANETSCALE_SERVICE_TOKEN_ID`, `PLANETSCALE_SERVICE_TOKEN`, and the `secret_store` schema belong to the OpenBao control plane. Never read, request, inject, migrate, inspect, or reuse them from an application.
- Do not create a database, branch, role, extension, replica, or provider project from another repo. Those are infrastructure resources and must be declared in `{{infraRepo}}` with OpenTofu. Application repositories own their allocated schemas and table migrations; the platform does not reconcile their application DDL.
- A new app needs an explicitly allocated database/schema before it runs DDL or writes data. Include the requested app id, schema name, extensions, migration command, and whether both `dev` and `prd` are required in the hosting request (§5). Record an allocated schema in the service inventory as `database_schema`; its application migrations may create and evolve only that schema. If no allocation is recorded in the approved infrastructure change, stop; possession of the shared credential is not authorization to use another app's tables.
- Keep dev and production separate by loading the matching Vault config. Never copy production data into dev or point a local process at `prd` unless the human explicitly requests it.
- Use parameterized queries. Put schema changes in deterministic, committed migrations and make the deploy strategy explicit. Never perform destructive or irreversible migrations automatically; use expand/migrate/contract changes and a reviewed backup/rollback plan.
- Configure a small bounded connection pool, release clients in `finally`, set query/statement timeouts, retry only transient connection failures with bounded backoff, and make write retries idempotent. Do not retry constraint errors or arbitrary transactions.

### Local development

Load the development URL through the same `.vault.yaml` contract as §1:

```bash
vault run -- sh -c 'psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "select 1"'
vault run -- bun run dev
vault run -- bun run db:migrate       # only after the app's schema is allocated
```

The quoting in the `psql` example is intentional: the child shell expands `DATABASE_URL` after `vault run` injects it. A command such as `vault run -- psql "$DATABASE_URL"` expands too early and usually passes an empty value.

Minimal Node/Bun shape (use the project's existing PostgreSQL library if it has one):

```ts
import { Pool } from 'pg';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL is required');

export const db = new Pool({
  connectionString, // preserve provider-required TLS/query parameters
  max: 5,
  connectionTimeoutMillis: 10_000,
  statement_timeout: 30_000,
});
```

Do not add an unconditional custom `ssl` object: many clients let it override TLS parameters already encoded in the managed URL.

### CI and hosted runtime

- **CI:** request `{{databaseSecret}}` with the GitHub OIDC Vault step from §1. Expose it only to the migration/test step that needs it; do not write it to `$GITHUB_ENV`, artifacts, caches, summaries, or logs.
- **Hosted runtime:** list `{ "name": "{{databaseSecret}}", "source": "vault" }` in the service's OpenTofu inventory `secrets`. The services copies the `prd` value into Railway. The app does not fetch Vault directly.
- **Tests:** prefer an isolated disposable local PostgreSQL instance. Tests must not mutate the shared dev database unless the human explicitly requests an integration test and the app has an isolated schema.
- **Health checks:** do not make the public liveness path depend on a database query. Check database readiness separately at boot or through a diagnostic endpoint; transient database trouble must not create a restart loop.

Verify without exposing connection details:

```bash
vault run -- sh -c 'psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -Atqc "select 1" | grep -qx 1'
```

---

## 3. Local Turborepo caching

Turborepo remote caching is retired. The server source remains dormant at {{path:packages/turborepo-remote-cache}}. Do not configure clients, copy cache credentials or probe the former Turbo endpoint.

Use local caching; remove `TURBO_API`, `TURBO_TOKEN` and `TURBO_TEAM` from client environments. Replace any `TURBO_CACHE=remote:rw` setting with `TURBO_CACHE=local:rw`. In `turbo.json`, set:

```json
{ "remoteCache": { "enabled": false } }
```

GitHub Actions may continue persisting `.turbo` through `actions/cache`.

---

## 4. Object store (Cloudflare R2, S3-compatible)

Shared buckets, one per Vault config; apps partition them by key prefix.

{{block:buckets}}

**Env vars** (Vault `{{kvMount}}/{{kvProject}}/{dev,prd}`):

{{block:s3Env}}

**Rules**

- **Prefix every key with your app id**: `<app-id>/…` (e.g. `moviefinder/posters/123.webp`). Never write, list, or delete outside your prefix — other apps share the bucket, and `{{objectKeyPrefix}}/` belongs to the Turborepo cache. Make the prefix a single constant at the composition root.
- The current credentials can reach a shared bucket; the prefix is an isolation contract, not an IAM boundary. Validate every caller-supplied key after normalization, reject `..`, leading `/`, empty segments and backslashes, and never accept a complete object key directly from an HTTP request.
- Read the bucket from `S3_BUCKET`; never hardcode bucket names. dev vs prd is selected purely by the Vault config you run with.
- Use path-style addressing: `${S3_ENDPOINT}/${S3_BUCKET}/${key}`.
- Buckets are private. Serve objects through your app (or presigned URLs), never public bucket URLs.
- Store the authoritative MIME type and size as object metadata; do not trust a download filename or user-provided `Content-Type`. Stream large bodies instead of buffering them, place explicit size limits on uploads, and use multipart upload only when the chosen SDK can abort failed uploads.
- Treat `PUT` of the same key as replacement. Generate immutable/versioned keys when overwrites would break caches, and delete only keys that your app recorded as owned. R2 listing is paginated; follow continuation tokens until complete.
- Do not create buckets or R2 tokens; provisioning lives in `{{infraRepo}}` (`{{script:infra}} apply`).

**Clients**

```ts
// Workers / Bun / Node — tiny, fetch-based (what {{infraRepo}} uses)
import { AwsClient } from 'aws4fetch';
const s3 = new AwsClient({
  accessKeyId: env.S3_ACCESS_KEY_ID,
  secretAccessKey: env.S3_SECRET_ACCESS_KEY,
  region: env.S3_REGION, // "auto"
  service: 's3',
});
const base = `${env.S3_ENDPOINT.replace(/\/$/, '')}/${env.S3_BUCKET}`;
const key = `myapp/${id}`;
const objectUrl = `${base}/${key.split('/').map(encodeURIComponent).join('/')}`;
await s3.fetch(objectUrl, {
  method: 'PUT',
  body: bytes,
  headers: { 'content-type': type },
});
const res = await s3.fetch(objectUrl); // 404 → missing
```

```ts
// @aws-sdk/client-s3
new S3Client({
  endpoint: process.env.S3_ENDPOINT,
  region: process.env.S3_REGION,
  forcePathStyle: true,
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY_ID!,
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY!,
  },
});
```

Any other S3 SDK works with the same five values + path-style. AWS CLI: `aws s3 ls s3://$S3_BUCKET/myapp/ --endpoint-url $S3_ENDPOINT` (with `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` set from the `S3_*` vars).

Recommended shape: hide the SDK behind a small interface — `get(key) → {body, contentType, size} | null`, `put(key, bytes, contentType)` (idempotent), `head(key) → boolean`, `delete(key)` (no-op if missing), `withPrefix(prefix)` — plus an in-memory implementation for tests.

---

## 5. Hosting on the managed services

`{{infraRepo}}` hosts apps on Railway (project `{{railwayProject}}`, region `{{railwayRegion}}`) behind `*.{{zone}}` hostnames with TLS and DNS managed by OpenTofu. **Railway never builds your code.** Every hosted project is Dockerized, CI publishes a **prebuilt image** to GHCR, and the services deploys that exact image.

### Contract your project must meet

- **Dockerized.** A `Dockerfile` (multi-stage; build tools in the build stage, minimal runtime stage) that builds with plain `docker build -f <dockerfile> <context>` — no build args or secrets required. The build must run in CI for `linux/amd64`.
- **Prebuilt image.** Built and pushed only by the shared publish workflow below, as `{{ghcrPattern}}:<git-sha>` and `:latest`. Never enable Railway's GitHub/Nixpacks builds, never run `railway up`, never push images by hand. Railway pulls the GHCR image selected by OpenTofu. All images must be public and allow anonymous pulls. The inventory rejects private registry credentials; `bun run health --only images` checks anonymous GHCR pulls.
- **One port.** The container listens on `0.0.0.0:<port>` and that port equals `port` in `OpenTofu inventory`. Read `PORT` from env (the services sets it via `env:`) with the same default in code.
- **Health check.** `GET <health_path>` (default `/`) returns 2xx within seconds of boot, without auth and without depending on third-party services. Deploys that fail it are marked failed.
- **Config from env only.** Runtime secrets are injected by the services from Vault as env vars (`secrets:` in `OpenTofu inventory`). Nothing secret in the image, repo, or Dockerfile; no `.env` files read in production. Fail fast at boot with a clear message naming any missing var.
- **Stateless.** Containers can be replaced at any time: no local disk state (use Postgres via `DATABASE_URL` or the object store), logs to stdout/stderr, handle `SIGTERM` gracefully.
- **Small and reproducible.** Pin base images (e.g. `node:22-bookworm-slim`, `oven/bun:1.3`, `nginx:alpine`), commit a lockfile and install with it frozen, and add a `.dockerignore` (`node_modules`, `.git`, `.env*`, build output).

Minimal Dockerfiles to start from:

```dockerfile
# Static site (Vite/Astro/etc.) served by nginx on port 80
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
```

```dockerfile
# Bun HTTP server on $PORT (default 8080)
FROM oven/bun:1.3 AS build
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production
COPY . .

FROM oven/bun:1.3-slim
WORKDIR /app
ENV NODE_ENV=production PORT=8080
COPY --from=build /app /app
USER bun
EXPOSE 8080
CMD ["bun", "run", "src/server.ts"]
```

Verify locally before wiring CI: `docker build -t app . && docker run --rm -p 8080:8080 -e PORT=8080 app`, then `curl -fsS localhost:8080<health_path>`.

### Step 1 — open a hosting request issue (on `{{infraRepo}}`)

You cannot add a service from another repo — the services only runs what `packages/infra/tofu/modules/inventory/inventory.tf.json` in `{{infraRepo}}` declares, and an agent working there adds it. Your job is to hand that agent **everything** it needs in one GitHub issue, so it never has to open your repo to guess: where the image lives, how to run it, which secrets it needs, and how the project should appear on the portfolio at `https://www.{{zone}}`.

1. Meet the contract above and verify the image locally (`docker build` + `docker run` + `curl` the health path). Do not open the issue until that works.
2. Commit the publish workflow (Step 3) in the same change, so the image already exists on GHCR when the infra agent deploys it. Until the service entry lands, the deploy step in `{{infraRepo}}` fails with "service id not found" — that is expected.
3. Check for an existing request first: `gh issue list -R {{infraRepo}} --state all --search "[hosting] <id> in:title"`. Update that issue instead of opening a duplicate.
4. Fill in **every** field of the body below (write `none` / `n/a` rather than deleting a field), save it to a scratch file outside the repo, and open the issue:

   ```bash
   gh issue create -R {{infraRepo}} --label enhancement \
     --title "[hosting] <id> — <one-line summary>" \
     --body-file /tmp/hosting-request.md
   ```

   If `gh` is not authenticated or the human lacks access to `{{infraRepo}}`, give the human the filled-in body and the command instead.

5. Tell the human the issue URL. When the infra agent comments with the live URL, confirm `curl -fsS https://<hostname><health_path>` succeeds.

**Never put secret values in the issue** (it is public). List secret _names_ only; the human writes values into Vault.

Issue body — copy it verbatim and replace every `<…>`:

```md
## Service

| Field                | Value                                                                                   |
| -------------------- | --------------------------------------------------------------------------------------- |
| Service id           | `<id>` — kebab-case, unique in `OpenTofu inventory`; becomes the Railway name and GHCR name  |
| Summary              | <one sentence: what the app is and who uses it>                                         |
| Source repo          | `<owner>/<name>` (<public/private>), default branch `<main>`                            |
| Source code URL      | <https://github.com/owner/name or …/tree/main/path for a monorepo package>              |
| Requested hostname   | `<sub>.{{zone}}` (or "any")                                                             |
| Kind                 | <static site / HTTP server / API / websocket server / other: …>                         |
| Stack                | <language, framework, runtime version, package manager>                                 |

## Authentication (if needed)

- Shared Google/OIDC relay: <yes/no>; production/nonproduction: <...>
- Project / instance names: <...>; exact owned callback URLs/origins: <...>
- Loopback development / preview lifecycle / expiry needs: <...>
- Registration credential id(s), Vault config(s), repository and exact CI OIDC subject(s): <metadata only; never a token>
- Ownership evidence: <repo/deployment/domain evidence the platform operator can verify>

## Image

| Field               | Value                                                                                       |
| ------------------- | ------------------------------------------------------------------------------------------- |
| Image source        | <shared publish workflow → `{{ghcrPattern}}` / external image: `<registry/name:tag>`>       |
| Image reference     | `<full ref, e.g. {{ghcrPattern}}:latest>`                                         |
| Already published?  | <yes — tag/SHA `<sha>`, run <link> / not yet>                                               |
| Dockerfile          | `<path relative to repo root>`                                                              |
| Build context       | `<path relative to repo root>`                                                              |
| Platform            | `linux/amd64` builds in CI: <yes/no>                                                        |
| Publish workflow    | <committed at `{{publishWorkflowPath}}` in <commit/PR link> / not yet / n/a (external)>     |
| Image size          | <approx MB>                                                                                 |

## Runtime

| Field                 | Value                                                                        |
| --------------------- | ---------------------------------------------------------------------------- |
| Port                  | `<port>` (reads `PORT` from env: <yes/no>, default `<port>`)                 |
| Health path           | `<path>` → <status code>, no auth, no third-party calls                      |
| Boot time             | <seconds until the health path is 2xx>                                       |
| Start command         | `<CMD / ENTRYPOINT>`                                                         |
| Plain env vars        | <`NAME=value`, one per line — non-secret only — or none>                     |
| Websockets / SSE      | <yes/no>                                                                     |
| Background work       | <cron jobs, queues, long-running tasks — or none>                            |
| Persistent disk       | none (required — containers are stateless; use Postgres or the object store) |
| Memory / CPU needs    | <typical / peak, or "small">                                                 |
| Graceful `SIGTERM`    | <yes/no>                                                                     |

## Secrets and shared infra

Names only — never values.

| Env var  | Already in Vault `{{kvProject}}`? | Configs      | Purpose / where the human gets the value |
| -------- | --------------------------------- | ------------ | ---------------------------------------- |
| `<NAME>` | <yes (reuse) / no (new key)>      | <dev, prd>   | <e.g. "TMDB API read token from …">      |

- Postgres (`DATABASE_URL`): <needed / not needed>; migrations run <at boot / manually / n/a>
- Object store (R2): <needed / not needed>; key prefix `<prefix>/`
- Turborepo caching: local only (remote service retired)
- Vault access from CI (OIDC): <needed / not needed>

## Local verification

<paste the exact commands you ran and their trimmed output:>

    docker build -f <dockerfile> -t <id> <context>
    docker run --rm -p <port>:<port> -e PORT=<port> <id>
    curl -fsS -o /dev/null -w '%{http_code}\n' localhost:<port><health_path>

## Portfolio entry

| Field           | Value                                                                                           |
| --------------- | ----------------------------------------------------------------------------------------------- |
| List it?        | <yes — main list / yes — archive (below the fold on /projects/) / no>                           |
| Project id      | `<id>` (kebab-case; usually the service id)                                                     |
| Title           | <display name, e.g. "Snake" or "moviefinder.app">                                               |
| Setting         | <side / work>                                                                                   |
| Deployment      | <public: `https://<hostname>` / private / not-deployed-yet>                                     |
| Code            | <public: <repo URL> / private>                                                                  |
| Description     | <1–2 plain sentences (~150–300 chars): what it does, then the interesting constraint or why>    |
| Topics          | <from the allowed list below, most important first; ask for new ones separately>                |
| Screenshots     | <"capture from deployment URL" / public image URLs — landscape, ≥1280px wide>                   |
| Demo video      | <YouTube video id, or none>                                                                     |
| Include on resume | <yes / no>                                                                                    |
| Highlights      | <optional: 1–3 facts worth featuring — scale, notable tech, users>                              |

## Anything else

<custom domain needs, rate limits, known caveats, who to ask — or none>
```

Portfolio topics (use these exact keys; a new topic needs an icon, so ask for it in the issue instead of inventing one): {{portfolioTopics}}.

### Step 2 — the service entry (added in `{{infraRepo}}` from your issue)

Application repositories own publisher workflows and validation. Set `managed_publisher = false` and list `required_status_checks` in the repository inventory entry to retain that ownership while using the shared image build/deploy workflow.

The infra agent turns your issue into an entry like this in `packages/infra/tofu/modules/inventory/inventory.tf.json` (when you are working inside `{{infraRepo}}` yourself, add it and run `{{script:infra:services}} plan` to review the plan). Use it to check that your issue answers every field:

```json
{{block:serviceExample}}
```

| Field             | Meaning                                                                                         |
| ----------------- | ----------------------------------------------------------------------------------------------- |
| `id`              | Service id: Railway service name, GHCR package `{{imagePrefix}}-<id>`, and publish `service_id` |
| `hostname`        | Public hostname on `{{zone}}`; DNS and TLS are provisioned automatically                        |
| `github_repo`     | `owner/name` of the repo that publishes the image                                               |
| `source_code_url` | Link shown on the portfolio                                                                     |
| `dockerfile`      | Dockerfile path, relative to the repo root                                                      |
| `build_context`   | Docker build context, relative to the repo root                                                 |
| `port`            | Port the container listens on                                                                   |
| `health_check`    | Probe the service after deploys                                                                 |
| `health_path`     | Path probed (default `/`); must return 2xx                                                      |
| `env`             | Plain, non-secret env vars                                                                      |
| `secrets`         | `name` + `source: vault` → value copied from Vault `{{kvProject}}/prd` into the service's env   |
| `image`           | Optional external image, used verbatim (skips GHCR publishing entirely)                         |

### Step 3 — add the publish workflow (in your repo)

Commit exactly this as `{{publishWorkflowPath}}` (from `{{infraRepo}}`, `{{script:infra}} apply` generates and pushes it for every service of that repo). If the repo's default branch is not `main`, change the trigger branch:

```yaml
{{block:publishWorkflow}}
```

It calls `{{infraRepo}}`'s `ci.yml` as a reusable workflow. Inputs:

{{block:workflowCallInputs}}

Caller secrets: `{{dispatchSecret}}` (the OpenTofu-managed platform PAT, used to publish existing GHCR packages and dispatch deployment; requires repository/workflow access and `write:packages`) and `CALLER_GITHUB_TOKEN` (pass `github.token`; publishing fallback when the platform token is absent). Update missing or rotated credentials through the OpenTofu foundation root.

### What happens on every push to `main`

1. Your repo's publish job builds the Dockerfile and pushes `{{ghcrPattern}}:<sha>` + `:latest`.
2. It sends `repository_dispatch` `{{dispatchEvent}}` with `{"id": "<id>", "image_tag": "<sha>"}` to `{{infraRepo}}`.
3. `{{infraRepo}}` CI applies OpenTofu DNS / Railway resources from `OpenTofu inventory`, syncs the declared Vault secrets into the service, deploys the image at that SHA, and health-checks `https://<hostname><health_path>`.

Check it: `gh run list -R {{infraRepo}} --workflow ci.yml --limit 3`, then `curl -fsS https://<hostname><health_path>`. Never redeploy from the Railway dashboard; a human can redeploy with `gh workflow run deploy.yml -R {{infraRepo}} -f action=deploy -f service_id=<id> -f image_tag=<sha>`.

### Current services

Working examples to copy from — each links to its source repo:

{{block:services}}

---

## 6. Auth relay (Google sign-in)

**Status: `{{authStatus}}`; live Google, reliability and browser acceptance remain incomplete.** Configured endpoints below do not establish readiness. Check discovery and the [acceptance record](https://github.com/{{infraRepo}}/blob/main/packages/auth-relay/acceptance.md) before relying on the relay. Missing deployment, credentials or approval are blockers; never substitute mock authentication or disable verification.

| Use | Console / agent API origin | OIDC issuer |
| --- | --- | --- |
| Production HTTPS apps | `{{authProductionOrigin}}` | `{{authProductionIssuer}}` |
| Localhost, development, CI, staging, previews | `{{authNonproductionOrigin}}` | `{{authNonproductionIssuer}}` |

### Information and credentials to collect

| Item | Source | Secret? |
| --- | --- | --- |
| Project, environment, instance, exact callbacks, registration expiry | Your app and the operator-approved grant | No |
| Relay origin and issuer | Table above; discovery at `<issuer>/.well-known/openid-configuration` | No |
| Client ID, callback, scopes | Successful registration response / console connection settings | No; safe as runtime configuration |
| `AUTH_RELAY_AGENT_TOKEN` | **Isolated** Vault `{{kvMount}}/auth-relay-agents/<credential-id>/<config>`; obtain the exact credential id/path from platform onboarding | Yes; use only in registration tooling |
| Vault CI role | `auth-relay-agent-<credential-id>`; exact repository + OIDC subject binding | Role name is public; use GitHub OIDC, no static Vault token |
| Session encryption/signing secret, if your framework requires one | A separate application secret in Vault | Yes; never use the registration token as a session secret |

Applications are **public PKCE clients**: there is no consuming OIDC client secret. Never request or copy `GOOGLE_OAUTH_*`, `AUTH_MANAGER_*`, `AUTH_CONSOLE_*`, `AUTH_RELAY_DATABASE_URL`, setup tokens, or platform database/provider credentials. A registration credential does not grant application users access, and a Google sign-in does not make someone a relay operator.

### One-time onboarding (platform operator)

1. Request a credential id, repo and exact GitHub OIDC subject, relay environment, project, approved HTTPS origins, whether changing loopback ports are needed, and expiry. Include this in the hosting request when applicable. Verify repository/deployment/domain ownership; a hostname or Google email alone is not evidence. No wildcard or shared hosting suffix approvals.
2. In `{{infraRepo}}`, add an entry to the **complete** `auth_agent_credentials` input map of the Vault OpenTofu root. Persist it in the existing OpenTofu-owned `TOFU_VAULT_INPUTS` input, preserving all other fields. Example metadata (no credential values):

   ```json
   {
     "my-app-dev": {
       "config": "dev",
       "repository": "owner/my-app",
       "subject": "repo:owner/my-app:ref:refs/heads/main",
       "generation": 1
     }
   }
   ```

   Use a separate id and `config: "prd"` for production. Protected GitHub environments can use an exact `repo:owner/my-app:environment:production` subject instead. An untrusted PR must never receive a production credential. This input controls credential delivery only; application registrations and callback scopes are never OpenTofu inventory entries.
3. Review and apply a saved Vault-root plan through the existing deployment workflow. OpenTofu generates the random credential, writes only its isolated Vault document, and creates a read-only policy/JWT role restricted to that document. Shared `personal/*` CI/runtime tokens cannot read it. If a resource already exists, import it before applying; never replace it to adopt it.
4. Read the **nonsecret** `auth_agent_credentials` OpenTofu output for path, role and SHA-256 fingerprint. In the correct relay console, sign in as an authorized operator, open **Agent access**, and approve that fingerprint with one project, allowed environments, exact owned HTTPS origins, optional nonproduction loopback access and expiry. Paste only the fingerprint, never the token. Application data goes into the relay's isolated PostgreSQL schema. The singleton first-operator setup and Google configuration remain platform-only operations.
5. Supply the integrating agent the credential id/path/role, approved project/scopes/expiry and relay origin. All of these are public metadata. Local agents use an existing authorized Vault login; grant narrowly scoped Vault read access through OpenTofu if needed, never a root/operator token. Runtime app containers never receive the registration credential.

Grant leases last at most seven days outside production and 366 days in production. Registrations cannot outlive the grant. Operators renew grants explicitly. Rotate by incrementing `generation` in the credential input, applying the reviewed plan, and replacing the fingerprint on the **existing** grant. Its id and application ownership remain stable; the old token then fails immediately. Revoke **Agent access** to stop registration operations; revoke application clients separately to stop their new sign-ins. Existing app sessions follow the app's own policy.

### Register from another project

The dependency-free [Bun agent client](https://github.com/{{infraRepo}}/blob/main/packages/auth-relay/agent.ts) can be copied into your project, inspected and pinned to a reviewed commit. No private `@pkgs/*` imports or platform checkout is needed:

```bash
# Download source for review; replace main with a reviewed commit for reproducibility.
curl -fsS https://raw.githubusercontent.com/{{infraRepo}}/main/packages/auth-relay/agent.ts -o auth-relay-agent.ts

# List only the fields that would be injected; no values.
vault run --path {{kvMount}}/auth-relay-agents/my-app-dev/dev --dry-run -- bun auth-relay-agent.ts --help

# A fingerprint is public; it can be supplied to the operator without revealing the token.
vault run --path {{kvMount}}/auth-relay-agents/my-app-dev/dev -- bun auth-relay-agent.ts fingerprint
vault run --path {{kvMount}}/auth-relay-agents/my-app-dev/dev -- bun auth-relay-agent.ts list --origin {{authNonproductionOrigin}}
```

Commit a **public** `auth-registration.json`. The helper defaults to a one-hour lease capped at the grant expiry; optionally set an explicit future `expiresAt` or `--ttl-seconds` within the grant and environment limits:

```json
{
  "name": "My app local",
  "project": "my-app",
  "environment": "localhost",
  "instance": "dev-server-one",
  "callbacks": ["http://localhost:5173/auth/callback"]
}
```

```bash
vault run --path {{kvMount}}/auth-relay-agents/my-app-dev/dev -- bun auth-relay-agent.ts register --origin {{authNonproductionOrigin}} --file auth-registration.json
# Teardown: use the public client id from the registration result.
vault run --path {{kvMount}}/auth-relay-agents/my-app-dev/dev -- bun auth-relay-agent.ts revoke --origin {{authNonproductionOrigin}} --id app-<UUID>
```

For changing ports, supply `--callback http://localhost:<actual-port>/auth/callback` after the server binds; this overrides the single callback without editing the file. `--ttl-seconds 3600` requests a fresh one-hour lease capped at grant expiry.

The helper looks up the immutable `(project, environment, instance)`, reuses its client id and supplies its current revision. Re-running updates/renews that client, including an exact port change, without a Google change or deployment. Give each simultaneous server/preview a different instance. Choose the actual bound port before registering; do not advertise readiness until registration succeeds. Preview teardown revokes its client; expiry remains a fallback when teardown fails. A separately approved loopback grant permits changing explicit ports, never wildcard redirect URIs.

Only clients created under this grant can be listed, updated or revoked by its credential. An operator-created client or another grant's client cannot be adopted by guessing its id/project. For an identity collision, ask an operator to resolve ownership; do not generate new ids repeatedly. Writes use revision checks. On a timeout or conflict, list again and reconcile the saved state before retrying; no request is automatically retried. New-client provider failures retain a pending identity for recovery.

### CI registration without a static Vault token

Use the credential's dedicated role, **not** the shared application role from §1. Adapt the subject-bound job/ref/environment to the approved onboarding metadata:

```yaml
permissions:
  contents: read
  id-token: write
steps:
  # Checkout and install the project's pinned Bun runtime first.
  - uses: hashicorp/vault-action@v4
    id: relay-credential
    with:
      url: {{vaultAddr}}
      method: jwt
      path: {{jwtPath}}
      role: auth-relay-agent-my-app-dev
      jwtGithubAudience: {{vaultAddr}}
      exportEnv: false
      secrets: |
        {{kvMount}}/data/auth-relay-agents/my-app-dev/dev AUTH_RELAY_AGENT_TOKEN | AUTH_RELAY_AGENT_TOKEN
  - run: bun auth-relay-agent.ts register --origin {{authNonproductionOrigin}} --file auth-registration.json
    env:
      AUTH_RELAY_AGENT_TOKEN: ${{ steps.relay-credential.outputs.AUTH_RELAY_AGENT_TOKEN }}
```

Do not echo credentials, enable shell tracing, write them to `.env`, arguments, `$GITHUB_ENV`, job summaries, artifacts or caches. Inject them only into the registration step. Keep the production credential out of fork/PR jobs and browser code.

### Plain HTTP contract (any language)

Use HTTPS with `Authorization: Bearer <Vault-injected AUTH_RELAY_AGENT_TOKEN>` and `Content-Type: application/json`. No cookies, browser Origin, redirect following or CORS. Keep the credential in process memory; never send it in the URL. Paths are relative to the selected relay origin:

| Method / path | Contract |
| --- | --- |
| `GET /agent/v1/clients` | Returns `issuer`, approved `grant`, and this grant's `clients` including `id`, `revision`, `config`, `desired`, `revoked`. Pending records have null `config`; use `desired` to reconcile identity. |
| `PUT /agent/v1/clients/app-<UUID>` | Registration JSON above plus explicit `expiresAt` (ISO-8601 timestamp) and `revision` (0 for a new UUID; returned revision for updates). Returns `id`, `issuer`, next `revision`, and public `settings`. Identity is immutable; 1–8 exact callbacks. |
| `DELETE /agent/v1/clients/app-<UUID>` | Revokes only this grant's client; returns `ok`. Repeating revocation is safe. |

`401`: missing/unknown/expired/revoked credential; check Vault path, selected environment and fingerprint. `403`: browser-origin/cookie request denied. `400`: invalid registration, delegated scope, ownership or stale revision; inspect local metadata and re-list. `429`: honor `Retry-After`. `503`: dependency failure; reconcile before retrying a write. Errors contain no credential values. Agent credentials cannot access `/api/*` console/operator/setup operations.

### Configure and verify the consuming app

Use returned public `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_REDIRECT_URI` and `OIDC_SCOPES=openid email profile`. Discover endpoints at `<issuer>/.well-known/openid-configuration`. Use a maintained library supporting public clients, authorization code, mandatory S256 PKCE, `token_endpoint_auth_method=none`, random state and nonce. Optional `kc_idp_hint=google` skips the provider choice. Confidential client, implicit, password, refresh and iframe silent-renew flows are outside the supported profile.

Bind each ten-minute, single-use transaction to the exact client/callback, browser, state, nonce and verifier; separate concurrent tabs. Never retry a one-time code exchange after an error/timeout. Validate signature, exact issuer, audience, nonce and expiry; cache JWKS with bounded freshness and refresh once on an unknown key. Identify people by `(iss, sub)`, never automatically link accounts by email. A verified email alone grants no app permissions.

Each app owns its authorization and sessions. SSR sessions use host-only HttpOnly/Secure/SameSite=Lax cookies over HTTPS. Namespace local session/transaction cookies per project **and instance**: localhost ports do not isolate cookies. Browser-only clients keep transactions per tab and avoid persistent token storage. Use top-level redirects. Existing app sessions follow local policy during a relay outage; new authentication fails closed.

Before reporting success, verify discovery, registration readback, fresh login and callback/token validation, denied state/replay, concurrent tabs, and a second local instance. Confirm no registration credential enters the app bundle or runtime env. A missing deployment, Vault permission or operator approval is a precise blocker, not a passed check. Framework integration details and rollout evidence: {{path:packages/auth-relay/README.md}}, {{path:packages/auth-relay/operations.md}}, {{path:packages/auth-relay/acceptance.md}}.

---

## Troubleshooting

| Symptom                                        | Meaning / fix                                                                                                                  |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `vault run`: `No value found at {{kvMount}}/…` | KV empty, or wrong project/config in `.vault.yaml` — tell the human                                                            |
| `vault run`: permission denied / 403           | Token expired — the human runs `vault login …`                                                                                 |
| Vault HTTP 503                                 | Sealed (restart in progress) — wait and retry; the human can run `gh workflow run deploy.yml -R {{infraRepo}} -f action=unseal` |
| OIDC: audience error                           | Missing `jwtGithubAudience: {{vaultAddr}}`                                                                                     |
| OIDC: role / bound claim error                 | Repository or optional ref claim does not match the declared role — see §1 CI                                                 |
| R2: `SignatureDoesNotMatch`                    | Wrong secret key, region ≠ `auto`, or virtual-host addressing — use path-style                                                 |
| R2: `NoSuchBucket`                             | `S3_BUCKET` does not match the config's bucket                                                                                 |
| Publish: `id-token` / permissions error        | The caller workflow must grant `contents: read`, `packages: write`, `id-token: write` (Step 3 does)                            |
| Publish: `DEPLOY_DISPATCH_TOKEN is not set`    | Org secret missing — see Step 3                                                                                                |
| Deploy: service id not found                   | No `OpenTofu inventory` entry for that `service_id` yet — open the Step 1 issue                                                     |
| Deploy: health check fails                     | Container not listening on `port`, or `health_path` is not 2xx — reproduce with `docker run` locally                           |

---

## Handling a hosting request (agents working inside `{{infraRepo}}`)

Hosting requests are issues titled `[hosting] <id> — …` (`gh issue list -R {{infraRepo}} --search "[hosting] in:title" --state open`). Work one issue per branch and PR:

1. **Validate the request.** Every field is filled; the id and hostname are unused in {{path:packages/infra/tofu/modules/inventory/inventory.tf.json}}; the image reference exists (`docker manifest inspect <ref>` or the GHCR package page); no secret values appear anywhere in the issue (if one does, tell the human to rotate it and edit the issue). Ask for anything missing in an issue comment and stop — never guess a port, health path or secret.
2. **Declare the service.** Add the entry to `locals.inventory.services` in the OpenTofu JSON definition (fields as in Step 2; `image:` only for an external image). For each new secret, add it to `vault.kv_keys` with `configs` and `used_by: [<id>]`, then tell the human the required OpenTofu vault secrets input changes — never write values yourself.
3. **Plan.** `{{script:infra:services}} plan` (dry run) and check the plan only adds this service, its DNS record and its variable bindings.
4. **Publish workflow.** If the issue says it is not committed yet, `{{script:infra}} apply` generates it (ask the human before pushing to another repo).
5. **Portfolio.** When the issue asks for a listing, add a `Project` to {{path:packages/portfolio/src/content/projects/entries-part-2.ts}} (main list; append at the end) or {{path:packages/portfolio/src/content/projects/entries-archive.ts}} (archive), following {{path:packages/portfolio/src/content/projects/types.ts}}: `deployment: { t: 'public', url: 'https://<hostname>' }`, `code`, `description`, `topics` from {{path:packages/portfolio/src/content/topic.ts}}, and `imageSrc` / `galleryImageSrc` set to `/<id>-screenshot.optimized.webp`. Once the service is live, the human runs `bun run --filter @pkgs/portfolio gen` locally to capture the screenshot into `assets/` and its optimized derivative into `public/` (Playwright; never in CI) — commit both.
6. **Regenerate and check.** `{{script:llms:sync}}` (the services table changes), then `bun run check`.
7. **Ship.** Open the PR with `Closes #<issue>` in the body. After merge, watch CI (`gh run list -R {{infraRepo}} --workflow ci.yml --limit 3`), confirm `curl -fsS https://<hostname><health_path>`, and comment the live URL on the issue. If the deploy failed only because the entry was missing, redeploy with `gh workflow run deploy.yml -R {{infraRepo}} -f action=deploy -f service_id=<id> -f image_tag=<sha>`.

---

## Maintaining this file (agents working inside `{{infraRepo}}`)

`llms.txt` is generated — never edit it by hand. Prose lives in {{path:scripts/llms-txt.template.md}}; values, tables and the publish workflow come from {{path:packages/infra/tofu/modules/inventory/inventory.tf.json}}, {{path:.github/workflows/publish.yml}} and {{path:.github/workflows/deploy.yml}}, {{path:packages/turborepo-remote-cache/scripts/vault-secrets-registry.ts}} and {{path:packages/infra/lib/publish-workflow.ts}} via {{path:scripts/llms-txt.ts}}. Run `{{script:llms:sync}}` after changing any of them; `{{script:check:llms}}` (part of `bun run check`) fails CI on drift, on a dangling file reference, or on an unknown `bun run` script.
