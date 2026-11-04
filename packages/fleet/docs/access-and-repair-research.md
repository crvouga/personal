# Fleet access and repair research

Reviewed November 4, 2026. This compares the capabilities needed for this personal
fleet, using vendor documentation. Recommendations are engineering judgments for
this repository; no new service, subscription, account, agent or infrastructure
was installed or provisioned during this research.

## Recommendation

Keep **Tailscale + existing OpenSSH + mise + workstation + OpenBao/Vault** as the
current stack. Add a small repair planner over those existing owners. Authenticate
individual computers to the same permitted services, and let each machine fetch
shared secrets through its own authorization. Keep desired infrastructure and
resource permissions in OpenTofu.

For human passwords and shared login items, first use the repository's existing
[password-manager owner](../../password-manager/README.md) and its Bitwarden
integration. `bun run password-manager doctor` reports that owner's readiness;
`bun run password-manager actions list` exposes pending onboarding. Native CLI
sign-in approvals remain separate. No Bitwarden migration, rotation, account
change or private-state synchronization is part of fleet repair.

This provides consistent tools, shared configuration and permitted service access
without making one computer's credential files the source of truth. It also gives
operators clear native login steps when browser approval is necessary.

## Market comparison

| Tool                                                                                                                                                 | Relevant capability from official documentation                                                                                                    | Fit for this repository                                                                                                                                                                                                                                                                                    |
| ---------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [mise](https://mise.jdx.dev/dev-tools/mise-lock.html)                                                                                                | Lockfiles record tool resolutions/checksums; `mise install --locked` refuses missing lock entries.                                                 | Already the tool owner. Reuse the checked-in setup, locks and doctor rather than creating another installer.                                                                                                                                                                                               |
| [OpenBao Agent](https://openbao.org/docs/agent-and-proxy/autoauth/)                                                                                  | Auto-auth supports machine-appropriate methods and renewal/reauthentication; agent/proxy access is scoped by its authorization.                    | The existing OpenBao/Vault and secret-store are the best starting point. Continue runtime injection and supported workstation rendering. Agent deployment or new auth methods would need a separate reviewed OpenTofu change.                                                                              |
| [Bitwarden CLI](https://bitwarden.com/help/cli/) and [organizations](https://bitwarden.com/help/getting-started-organizations/)                      | CLI supports vault sync and separate login/unlock; organizations share items through collections and member permissions.                           | Already has a private integration in `packages/password-manager`. Use that owner's doctor/onboarding for human account records before considering a second manager. Keep its private state and OS credential store local; password vault access does not create native CLI OAuth sessions.                 |
| [1Password CLI](https://developer.1password.com/docs/cli/secrets-scripts/) and [SSH agent](https://developer.1password.com/docs/ssh/agent/security/) | `op run` injects referenced secrets into child processes; the SSH agent keeps private keys in 1Password and requests consent for use.              | A useful optional desktop credential manager if the operator already wants one. It would introduce a second secret authority and enrollment workflow here; do not migrate or purchase it implicitly. Fleet continues to disable agent forwarding.                                                          |
| [Tailscale SSH](https://tailscale.com/docs/features/tailscale-ssh)                                                                                   | Identity/access-policy based SSH with optional browser reauthentication in check mode. Server and client/platform constraints apply.               | Evaluate separately for eligible nodes if key management becomes burdensome. Current verified OpenSSH over Tailscale remains usable. Enabling Tailscale SSH and access policy is a separate owner-managed change, not a diagnostic repair.                                                                 |
| [chezmoi](https://www.chezmoi.io/user-guide/password-managers/)                                                                                      | Dotfile templates can integrate with password managers, including Vault, instead of embedding secrets in the source tree.                          | A strong general dotfile alternative. Existing workstation tooling already owns this fleet's links/provider configuration; two writers to the same paths would create conflicts. Retain one owner.                                                                                                         |
| [Teleport Workload Identity](https://goteleport.com/docs/machine-workload-identity/workload-identity/introduction/)                                  | Short-lived JWT/X.509 identities, SPIFFE compatibility, and an agent that requests/renews identities through configured trust.                     | Worth considering for a larger machine/service identity program. A Teleport deployment and access model would add infrastructure beyond the present personal fleet. No adoption is required for the current repair workflow.                                                                               |
| [Ansible](https://docs.ansible.com/projects/ansible/latest/playbooks_checkmode.html)                                                                 | Configuration management with module-dependent check/diff modes. Tasks can explicitly run normally even in check mode; diffs need secret handling. | Appropriate for a larger heterogeneous fleet, but adds a configuration authority. Current repair commands already delegate to mise/workstation over verified SSH; adopting Ansible would need a clear ownership boundary and must preserve OpenTofu-only cloud provisioning.                               |
| [Syncthing](https://docs.syncthing.net/users/faq.html)                                                                                               | Peer file synchronization, with platform-dependent permissions and metadata handling. Changes and deletions propagate.                             | Consider only for explicitly selected nonsecret user files. Use Git for source/configuration and application-owned storage/backups for shared service resources. Never synchronize HOME, OAuth caches, keychains, SSH keys, private password-manager state or live databases as a login-sharing mechanism. |

## Login and secret distribution

There are three different workflows to support:

1. **Human subscription/account sessions.** Codex, Claude Code, GitHub, npm and
   other native CLIs use their own login commands on the affected computer.
   Keep machine-local caches and OS credential stores local. Browser/passkey
   approval remains an operator action. The CLI returns commands and comments
   them in generated scripts; it does not execute login flows automatically.
2. **Shared permitted API keys.** The existing Vault/secret-store can inject
   secrets for a child process using `vault run --config dev -- COMMAND`.
   Run it on the machine that needs the access, after authorizing that machine.
   Select the intended project/config. Only already-managed keys are available;
   a missing key or insufficient policy is not repaired by creating another one.
3. **Tool configuration that requires a local key file.** The existing
   `ws opencode sync --strict` owner reads its approved provider catalog from
   Vault and writes its managed configuration with restrictive permissions.
   Review the resulting workstation diagnostics. Missing keys, Windows ACLs,
   resource permissions and actual live provider access can need further checks.

Sharing resource access means granting the intended identities access to the same
existing account/team/project, then verifying that context. Merely obtaining a
successful `whoami` response does not prove every resource permission. Machine
rosters contain SSH aliases and paths; they are not resource/secret inventories.

## Native login evidence and caveats

- [Codex authentication](https://developers.openai.com/codex/auth/) documents
  device login, credential stores, and account/provider authentication options.
  The generated recipe uses `codex login --device-auth`; validate locally with
  `codex login status`. This repository's default retains independent machine
  logins rather than distributing cached account sessions.
- [Claude Code authentication](https://code.claude.com/docs/en/authentication)
  distinguishes subscription, API-key and provider identities. Use native
  `claude auth login` and `claude auth status --json`. Review the active method;
  environment-based credentials can change the effective billing/account context.
- [GitHub CLI login](https://cli.github.com/manual/gh_auth_login) provides browser
  authorization and credential-store integration. The recipe pairs login with
  `gh auth setup-git`, then verifies `gh auth status --active`. An environment
  token can override the stored login and must be reconciled at its source.
- [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/) uses OIDC
  from supported CI providers. Prefer the existing release workflow once the
  exact trusted publisher is configured, rather than putting a publishing token
  on every developer computer. A normal CLI login and package publishing
  authorization are separate checks.
- [Railway CLI](https://docs.railway.com/cli) and
  [Wrangler commands](https://developers.cloudflare.com/workers/wrangler/commands/)
  supply native account flows. Installed help was checked for Railway's
  `--browserless` and Wrangler's `--browser` flag before adding their recipes.
  Codex device auth, Claude auth login and Copilot login help were checked too.
  Suppressing a browser does not make an OAuth loopback callback available across
  SSH. For headless Wrangler, prefer a scoped existing API token through the
  approved Vault config, or explicit operator-managed callback connectivity.

Gemini, Copilot and OpenCode credential presence is not treated as proof of live
provider authorization. Unsupported read-only checks remain explicit skips. No
model prompt or billable inference request is used as a login test.

## Repair implementation

`personal fleet repairs --json` lists owners, effects and operator commands.
`personal fleet repair` inspects all visible Tailscale computers and previews
repairs; `--local` and repeated `--node` intentionally select a smaller scope.
Unregistered, offline, ambiguous or unprobed machines remain blocked/manual.

Automated actions are allowlisted:

- `workspace`: the existing locked toolchain/frozen dependency sync, with receipt;
- `workstation`: existing `bun run ws:install --yes`, including launcher, PATH,
  managed configuration and available Vault-backed provider configuration;
- `providers`: existing workstation provider sync in strict mode.

`--apply --yes` executes eligible actions serially, stops subsequent actions on a
machine after failure, and obtains fresh diagnostics. A successful command does
not imply healthy services. `executionOk` and `healthOk` are separate; strict
remaining failures/warnings/skips produce exit 1.

A preview returns `planHash`; `--plan-hash HASH` refuses changed plans. Remote
requests also require explicit apply, an allowed action and a matching checkout
revision/shared-input fingerprint. This guard is not a full attestation of every
working-tree file. Trusted checkout scripts can execute and repairs can be
partial. A disconnect/deadline does not prove a remote installer stopped.

`--script` emits a POSIX script for review without running or saving it. It invokes
existing owners and uses verified SSH without agent forwarding. Native login
commands are comments for deliberate operator use. It is a point-in-time script,
not the plan-hash guarded CLI apply path; rerun the preview before using an old
script. Rerun whole-tailnet health after repairs and operator approvals.
