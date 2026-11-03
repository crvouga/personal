# Automated npm releases

The source workspace stays private. Only the allowlisted contents of
`packages/personal-cli/dist` are packed as **`@crvouga/personal`**.

## One-time bootstrap

Node, npm and Bun must be on PATH through the shared mise setup. npm 11.15+ is
needed for the bootstrap's `npm trust` command. Start with a read-only plan:

```sh
bun install --frozen-lockfile
bun run personal:release:plan
bun run personal:publish:bootstrap --apply --yes --npm-login
```

The bootstrap builds and installs/tests the exact tarball in an anonymous isolated
consumer, opens npm's account authorization, publishes the package if necessary,
and configures/verifies its GitHub trusted publisher. Approve npm login and any
npm account/2FA approval in your own terminal/browser. No npm password, recovery
code or long-lived publishing token needs to be supplied to this project.
The trusted publisher is **`crvouga/personal` / `ci.yml`**, with direct publishing
permission. npm validates the calling workflow for reusable workflows, so this
must be `ci.yml`, not the reusable `release-personal-cli.yml` filename.

Bootstrap is retryable: if content is already published, it only checks/configures
the publisher. Existing publishers are preserved; no connection is revoked or
replaced. npm account authorization uses an isolated temporary 0600 npmrc, which
is removed with its logs/cache when the command exits. Initial publication also
inherits your terminal so npm can request its publishing-specific 2FA approval.
Global npm login/config is
not changed. A hard process kill can leave a temporary directory; remove any
abandoned `personal-npm-auth-*` directory in your OS temporary directory.

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
**Check** includes this job. After Check/Fleet pass on main, the reusable
`release-personal-cli.yml` workflow:

1. Reads the public registry and hashes the release inputs.
2. Skips publication when the published content hash already matches.
3. Uses `0.1.0` initially, then automatically increments the current stable patch
   version. A higher source manifest version deliberately selects a minor/major.
4. Builds, allowlist-checks, packs and consumer-tests the exact tarball.
5. Publishes using npm's **GitHub OIDC trusted publishing**, without npm secrets.
6. Confirms the content hash, SHA-512 integrity and latest tag, with bounded
   read-only retries for registry propagation. Unconfirmed outcomes fail rather
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
npx --yes @crvouga/personal@latest fleet doctor --all --json
```

Do not claim release or green CI based on local checks. Deployment of the CI
workflow requires these source changes to land on main, and remote fleet coverage
requires actual locally configured SSH aliases and checkout paths.
