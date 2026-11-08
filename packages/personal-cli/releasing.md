# Automated npm releases

The source workspace stays private. Only the allowlisted contents of
`packages/personal-cli/dist` are packed as **`@crvouga/personal`**.

## One-time bootstrap

Node, npm and Bun must be on PATH through the shared mise setup. npm 11.15+ is
needed for the bootstrap's `npm trust` command. Start with a read-only plan:

```sh
bash scripts/dev/bootstrap.sh
exec "$SHELL" -l
```

The machine bootstrap needs no Bun or npm, installs the shared locked mise
toolchain and frozen workspace dependencies, and configures persistent shell
PATH. On native Windows use `& ./scripts/dev/bootstrap.ps1`, then reopen your
terminal. See [machine setup](../../scripts/dev/README.md) for new/remote nodes.
After refreshing your terminal, run:

```sh
bun run personal:release:plan
bun run personal:publish:bootstrap --apply --yes --npm-login
```

Release progress on stderr identifies each stage (`npm-version`, `build`,
`pack`, `consumer-install`, consumer commands and publisher verification).
Failures name the stage without exposing raw subprocess output or credentials.
The npm runner supports mise shims, shell launchers and native executables;
Windows `.cmd` launchers use npm's adjacent JavaScript entry point through Node.
To validate the complete build/pack/anonymous-consumer path without logging in,
publishing or changing trusted publishers, run:

```sh
bun run personal:build
bun run --cwd packages/personal-cli smoke
```

The bootstrap builds and installs/tests the exact tarball in an anonymous isolated
consumer, prints npm's account authorization URL, publishes the package if necessary,
and configures/verifies its GitHub trusted publisher. Approve npm login and any
npm account/2FA approval in your own terminal/browser. No npm password, recovery
code or long-lived publishing token needs to be supplied to this project.
The trusted publisher is **`crvouga/personal` / `ci.yml`**, with direct publishing
permission. The publishing job runs directly in `ci.yml` so the registered
workflow and executing workflow have the same identity. Do not move publication
into a reusable workflow: its OIDC identity can differ from the registered publisher.

npm may require a separate browser approval when reading trusted-publisher
settings after login. Interactive verification keeps a terminal attached and
uses npm's readable output so those approval URLs appear immediately; npm's JSON
mode buffers browser URLs until completion. Open approval URLs in your normal
local browser with access to your security key/passkey.

Bootstrap is retryable: if content is already published, it only checks/configures
the publisher. Existing publishers are preserved; no connection is revoked or
replaced. npm account authorization uses an isolated temporary 0600 npmrc, which
is removed with its logs/cache when the command exits. Initial publication also
inherits your terminal so npm can request its publishing-specific 2FA approval.
Global npm login/config is
not changed. A hard process kill can leave a temporary directory; remove any
abandoned `personal-npm-auth-*` directory in your OS temporary directory.

### Remote Mac / SSH browser approval

Run the bootstrap **on the Mac Mini** in an interactive remote terminal. If you
connect with SSH, use `ssh -t YOUR_ALIAS` to allocate a terminal. No browser is
needed on the Mini, and no port forwarding or copying npm credentials is needed.

1. Run `bun run personal:publish:bootstrap --apply --yes --npm-login` on the Mini.
2. When npm prints its HTTPS login URL, copy/open that **new URL on your MacBook
   Air**, sign in to npm and complete the account/2FA approval there.
3. **Leave the Mini's terminal running**. It waits for npm's approval and resumes
   automatically; no Enter-to-open-browser prompt is used. Ctrl+C cancels login.
4. Publishing may print another approval URL or ask for a one-time code. Open
   that URL on the Air too, or enter the requested code in the Mini's terminal.

Browser launch is disabled for the entire isolated npm session, including
publish-time web 2FA and trusted-publisher setup. npm update notices/progress are
disabled too; keep npm versions owned by the shared mise lock, not a global
`npm install -g`. After cancellation or expiry, rerun the command and use its new
URL, not an earlier session's URL. Treat approval links as private; never paste
them into reports or shared logs. Registry verification retries version and latest-tag propagation with 310 seconds of bounded propagation waits without republishing. Transient read failures are retried within that same bound. The browser approval is not proof of publication;
wait for registry-integrity and trusted-publisher verification to finish.

## Vault username/password login

If a suitable npm publishing token already exists in Vault, use:

```sh
bun run personal:publish:bootstrap --apply --yes --login
```

This prompts for **Vault username and password**, not a Vault token. The default
username is `crvouga`; set `PERSONAL_VAULT_USERNAME` to change it. Login creates a
temporary in-memory userpass session, reads the requested credential and revokes
the session immediately afterward. Nothing is written to `~/.vault-token`.
`PERSONAL_VAULT_PASSWORD_FILE` supports a private secret-delivery file for agents;
the caller owns deleting that file immediately after use. Never pass passwords as
command arguments. Noninteractive calls never prompt.

Defaults: Vault `https://vault.chrisvouga.dev`, document
`secret/data/personal/prd`, field `NPM_TOKEN`. Select an **existing** field/document
using `PERSONAL_NPM_TOKEN_KEY` / `PERSONAL_NPM_VAULT_PATH`. The token must permit
creating/publishing `@crvouga/personal` and satisfy npm's unattended-publish/2FA
policy. Recovery codes are not publishing credentials. Missing fields fail
clearly; no code guesses another secret, seeds values or changes Vault policy.
Vault auth, policy and secret changes remain exclusively OpenTofu-owned.

Existing npm `NODE_AUTH_TOKEN` / `NPM_TOKEN` are also supported for automation.
Local Vault access always uses username/password, never a user-supplied Vault
token or a saved `~/.vault-token`. `--login` explicitly chooses username/password
even when an npm credential is already injected. A publishing
token is passed only in the npm child environment; its temporary npmrc contains
an environment-variable reference, not the token itself.

## CI: automatic publishing after checks

The main **CI** workflow validates the CLI on Linux/macOS/Windows and Node
22/24/26, including installing the packed distribution into a clean directory
with anonymous registry configuration and running it on real Node. The required
**Check** includes this job. After Check/Fleet pass on main, the release job directly in
`ci.yml`:

1. Reads the public registry and hashes the release inputs.
2. Skips publication when the published content hash already matches.
3. Uses `0.1.0` initially, then automatically increments the current stable patch
   version. A higher source manifest version deliberately selects a minor/major.
4. Builds, allowlist-checks, packs and consumer-tests the exact tarball.
5. Publishes using npm's **GitHub OIDC trusted publishing**, without npm secrets.
6. Confirms the content hash, SHA-512 integrity and latest tag, with bounded
   read-only retries for registry propagation. Registry reads bypass stale CDN
   cache entries and verification waits for matching content and integrity. Unconfirmed outcomes fail rather
   than blindly republish.

Publishing is serialized with non-cancelling concurrency. Dispatch **CI** on main
to retry. PRs, merge queues, failed checks and non-main dispatches never publish.
Public-source CI includes npm provenance. Local bootstrap records its revision
and dirty-checkout status and does not claim CI provenance. Registry versions
are the checkpoint; no version-bump commits, tags or GitHub write access is needed.
Atlas and Mockingbird informed the bootstrap/trusted-publisher and exact-consumer
validation design; their accounts/publishers are never modified.

For an explicitly selected existing Vault-backed npm token instead of OIDC, set
the **repository variable** `PERSONAL_NPM_TOKEN_KEY` to its field name, never its
value. CI then uses existing GitHub → Vault OIDC (`jwt` / `github-actions`) to read
that one field from `secret/data/personal/prd`. No duplicate GitHub secret is
created. Leave the variable unset for default tokenless npm publishing.

## Recovery and verification

If publication is unconfirmed, rerun the **plan** first. Never guess a new version
or blindly repeat a publish. Bootstrap can resume publisher setup after a package
was published successfully. npm account access is a prerequisite for first
publication; Vault login alone cannot grant npm publishing access.

Verify the released consumer independently:

```sh
npx --yes @crvouga/personal@latest commands --json
npx --yes @crvouga/personal@latest fleet-status --json
```

Do not claim release or green CI based on local checks. Deployment of the CI
workflow requires these source changes to land on main, and remote fleet coverage
requires actual locally configured SSH aliases and checkout paths.

## Fleet-sync release gate

The Ubuntu fleet-sync flow is not yet a complete machine-convergence release.
Read `../fleet/docs/ubuntu-sync.md` before publication. The package build embeds
an automatically approvable source SHA only for a clean checkout; dirty builds
retain provenance metadata but require an explicit reviewed revision. The anonymous
consumer smoke covers the `fleet-sync` preview without a checkout. Passing those checks is not Ubuntu/service/provider acceptance.
