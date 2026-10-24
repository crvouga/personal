Implement a complete package named `password-manager` in this repository. This is my personal infrastructure workspace, organized as a Node.js and Turborepo monorepo. I already use Bitwarden. Build the package as a maintained part of this workspace, following its existing conventions.

The goal is to automate the entire practical lifecycle of discovering my accounts, consolidating existing credentials into Bitwarden, identifying problems, changing passwords, verifying that changes worked, managing related authentication and recovery work, and keeping everything maintained. Automate every step that has a reliable supported mechanism. When a provider, operating system, or authenticator requires my involvement, give me precise instructions, preserve progress, and resume automatically when possible.

Implement and test the system. Do not stop at a proposal, scaffold, collection of disconnected scripts, or a list of future integrations. Make reasonable implementation decisions after inspecting the repository. Ask only for information that cannot be obtained from the repository or deferred to a guided onboarding step.

# 1 Inspect the repository and integrate with it

Before choosing structure or tools, inspect the applicable `AGENTS.md` files, workspace declarations, root and sibling `package.json` files, package-manager lockfile, `turbo.json`, TypeScript configuration, check/test commands, and existing infrastructure packages.

Also inspect existing toolchain and provisioning configuration: `mise.toml`, `.mise.toml`, `mise.lock`, `.tool-versions`, Node version files, Nix/devbox/devcontainer configuration, container images, Brewfiles, and OS setup scripts where present. Inspect the existing secret-store, logging, configuration, CLI, scheduling, notification, storage, browser automation, and testing abstractions.

Use the repository's established package directory and npm scope. The package's recognizable name and CLI should be `password-manager`; do not invent a competing repository structure. Make it private unless this repository explicitly requires publishing. Use strict TypeScript and the existing Node runtime and package manager. Reuse existing libraries and ports before creating equivalents. An earlier standalone account-inventory script may be available as a behavioral reference, but its presence is not a prerequisite and its runtime must not become an unnecessary dependency.

Record a short implementation plan and integration decisions in the repository's normal location. Then execute the plan through completion. Preserve unrelated work. Refactor shared infrastructure where this package exposes a real deficiency, with appropriate regression coverage.

# 2 Product outcome and operating principles

Bitwarden remains the encrypted source of truth for managed credentials. This package orchestrates discovery, reconciliation, migration, maintenance, and provider-specific operations around it.

The normal experience should be:

1. Run one documented setup command from the repository root.

2. Connect the selected vault, email accounts, browser/export sources, and existing infrastructure inventory.

3. Discover accounts, reconcile identities, and explain coverage and uncertainty.

4. Produce a concrete plan of imports, conflicts, password changes, and recovery work.

5. Execute the selected plan with the maximum available automation.

6. Pause only the affected operation when my input is necessary, with exact instructions and a resume path.

7. Verify outcomes and continue from durable checkpoints after interruption.

8. Run ongoing discovery and health checks using the repository's normal scheduling system.

Keep these facts separate: an email mentions a service; an account is confirmed; its authentication method is known; a vault item exists; its credential is current; a change was submitted; the change was verified; recovery readiness is known. A single `managed: true` field is insufficient.

Do not promise that every online account can be discovered or every website can be changed unattended. Completion must be defined relative to configured sources, scan coverage, supported capabilities, and verified outcomes. Provider limitations should produce actionable workflow states, not vague TODOs or false success.

# 3 Declare and manage every dependency

Every dependency, including tools and system dependencies, must have a declared owner, a reproducible acquisition path, a version policy, and a diagnostic check. Documentation saying “install this first” is not sufficient when installation can be managed.

Use mise if the repository already uses it. Otherwise use the repository's established toolchain/provisioning mechanism. If none exists, introduce the smallest appropriate managed solution, preferably mise where suitable, and document the choice. Do not introduce another competing version manager or replace existing Nix/provisioning conventions merely for this package.

Cover all dependencies actually used, including:

- Node and the workspace package manager.

- Runtime and development npm packages and their transitive lockfile resolutions.

- Bitwarden's Password Manager CLI, `bw`.

- Playwright and its matching browser binaries.

- Browser runtime libraries on supported Linux systems.

- Native module build requirements, if a selected storage or keychain library needs them.

- Required OS credential-store facilities and their platform constraints.

- Any cloud, OAuth, encryption, notification, scheduling, archive, or provisioning executable invoked by the package.

- Browser extensions, if required by the chosen implementation.

Choose one owner for each executable: for example, a locked local npm dependency or a managed mise tool, rather than both. Resolve the managed executable explicitly. Do not silently fall back to an unrelated global binary found on `PATH`. Avoid unpinned downloads, undocumented global npm installations, and operational commands that update tools implicitly.

Check the repository's pinned mise version before using newer features such as bootstrap package declarations or project diagnostics. Commit required lockfiles and generated lock sidecars. Register native OS packages through the existing declarative provisioning mechanism. OS-provided facilities that cannot be separately installed must still have documented supported-platform requirements and doctor checks. Distinguish a versioned package declaration from a fully reproducible machine image; report any platform-managed version limits honestly.

Provide idempotent bootstrap/install tasks, a dependency inventory generated from authoritative configuration where possible, and an explicit upgrade workflow. Browser installation and native libraries must not be hidden prerequisites. Required administrator interaction should become a precise setup action, with the command, purpose, expected result, and continuation step.

Define the cold-start path as well: the command that installs Node must not itself require Node. Reuse the repository's bootstrap entry, or provide a small platform-appropriate launcher using declared OS prerequisites. If mise/the selected manager is absent or requires a trust decision, give the exact initial installation/trust action and continuation command. Verify setup starting before the managed runtime and package manager are available.

# 4 Package architecture and durable state

Use the repository's ports-and-adapters conventions. Keep domain decisions and workflow transitions independent of the CLI, Bitwarden, email providers, browser automation, and filesystem. Prefer straightforward typed modules and functions over an unnecessary plugin platform or dependency-injection container.

Define narrow boundaries for vault operations, secret access, discovery sources, account reconciliation, site/authentication adapters, browser sessions, durable workflow storage, scheduling, and user actions. Add clock/ID/randomness seams where needed for deterministic tests and reliable recovery.

Use an existing suitable storage abstraction, or a local durable database such as SQLite. Avoid introducing a database server or queue service for a single-user local workflow. Verify compatibility with the pinned Node version; do not assume a particular `node:sqlite` API or native driver is available without checking and declaring its requirements.

Persist source configurations and cursors, account evidence, confirmed identities, vault references, plans, operation states, pending user actions, capabilities, and sanitized audit events. Keep the schema versioned and support recoverable upgrades. Use transactional updates, per-account operation locks, bounded concurrency, and stale-lock recovery. Prevent two processes from mutating the same account or sharing the same browser profile concurrently.

Keep private operational state outside Git, Turbo caches, build outputs, ordinary CI artifacts, and synchronized source directories. Follow existing OS state-directory conventions or the repository's explicit private-state convention. A local SQLite database is not automatically encrypted. Store credentials, session tokens, pending replacement passwords, and other secret material through the existing encrypted secret facility or OS credential store; persist references in ordinary workflow metadata.

Configuration belongs in the repository where appropriate; secret values belong in its secret-management system. Validate configuration and version it. Model scopes, allowed accounts/domains, source identities, verified aliases, priorities, retry limits, schedules, retention, and execution policy explicitly. Defaults should work without a large hand-maintained list of services.

# 5 CLI and integrated operator workflow

Expose a package binary and convenient root-level commands using the actual repository runner. The following is the intended command surface; adapt naming where necessary while preserving the capabilities and documenting the real commands:

```text
password-manager setup
password-manager doctor
password-manager connect bitwarden
password-manager connect gmail
password-manager connect microsoft
password-manager sources list
password-manager discover
password-manager accounts list
password-manager accounts show <account-id>
password-manager accounts reconcile
password-manager audit
password-manager plan
password-manager apply <plan-id>
password-manager run
password-manager status
password-manager actions list
password-manager actions show <action-id>
password-manager resume <run-id>
password-manager recover <operation-id>
password-manager backup create
password-manager backup verify <backup-id>
password-manager schedule install
password-manager schedule status
password-manager schedule remove
password-manager cleanup
```

The integrated `run` workflow should orchestrate the component commands, explain what can happen automatically, and continue independent work when one account is blocked. Do not make the user manually assemble a pipeline of internal commands.

Support account/source filters, resumable runs, cancellation, useful progress, and stable machine-readable JSON output. Define exit statuses for completed, requires-user-action, partial, and failed outcomes. Noninteractive execution must never hang waiting for input. Distinguish skipped work from failed work and unknown outcomes from confirmed failures.

Planning and inspection must be available without live mutations. Explicitly applying a selected plan, or a previously configured execution policy, authorizes its stated actions; do not ask again before every step. New actions outside that scope require a revised plan. The package's implementation, dependency installation, ordinary tests, and default CI must not themselves alter my live accounts.

# 6 Setup diagnostics and authentication

Make setup a working, resumable onboarding flow. Detect the current platform and configured infrastructure, install declared dependencies through their owner, initialize private storage, connect supported sources, and finish with a useful status report. Automatically perform supported prerequisites using existing authorized infrastructure integrations. If a provider requires console setup, consent, account selection, or a hardware interaction, generate a guided action instead of leaving a generic error.

Keep `doctor` read-only. Check dependency versions and provenance, browser installation and native libraries, secret-store availability, private-state permissions, configuration, vault identity/server, authentication and unlock state, OAuth scopes, source reachability, and interrupted operations. Report `missing`, `wrong-version`, `unsupported-platform`, `locked`, `not-authenticated`, and `unavailable` distinctly, with an exact remediation command or action.

For Bitwarden, use `bw`, not the Secrets Manager CLI `bws`. Detect the selected CLI version's real capabilities. Bind operations to the expected server/region and account; never silently switch vaults. Isolate package-owned CLI state, for example through the supported `BITWARDENCLI_APPDATA_DIR` mechanism, so session cleanup does not disturb unrelated CLI use.

Account authentication and vault unlock are separate. Personal API-key login does not eliminate the need to unlock encrypted vault data. Current direct CLI login does not support every factor, including FIDO2/Duo; provide the documented supported path when applicable without asking me to disable MFA. Obtain secrets through secure prompts or the existing secret facility, keep sessions scoped, and clean up package-owned sessions on exit when appropriate.

For OAuth, use supported installed-app flows with the system browser, state validation, PKCE where supported, and a loopback callback bound to loopback only. Store refresh credentials securely. Reuse existing app registrations when appropriate. Automate cloud-project/API prerequisites only through real supported interfaces; do not invent commands for settings that require a provider console. Explain every remaining field, scope, redirect setting, test-user requirement, and consent step.

Detect token expiration, revocation, restricted scopes, consent changes, and OAuth testing-mode limitations. Source connectors must be usable independently where possible; reading an email archive should not require an unlocked vault. Identify dependency cycles in bootstrap or recovery secrets rather than storing the only unlock/recovery credential inside the locked system it must recover.

# 7 Account discovery and source coverage

Implement a unified discovery pipeline with real connectors and file adapters. Deliver working Bitwarden discovery, browser/password-manager export ingestion, streaming MBOX/EML ingestion, live Gmail discovery, and live Microsoft mail discovery. Add generic read-only IMAP where relevant and supported by the user's providers; make its authentication requirements explicit. All network connectors must have fixtures and real implementations, even if live credentials are not available during development.

Support multiple email accounts, historical addresses, aliases, browser profiles, and export files. Sources should include:

- Existing personal Bitwarden login items, with organization/shared ownership opt-in.

- Chrome-family, Firefox, and Apple Passwords/Safari exports in their supported formats.

- Compatible password-manager exports, with format validation and a documented support matrix.

- Account-related email evidence: registration, verification, password reset/change, security/login alerts, and subscription/billing messages.

- User-supplied confirmed accounts and known service/domain inventory already maintained in this infrastructure repository.

- Google/Apple linked sign-in inventories through supported interfaces or guided read-only browser review.

- Optional breach-source discovery with explicit coverage, credentials/costs if applicable, and incomplete-result semantics.

Automatically enumerate source/profile metadata where supported. Use legitimate browser/OS export and credential-transfer mechanisms, preserving their authentication prompts. Do not assume access to protected browser databases or native credential stores can be automated silently. Distinguish native/browser capabilities by platform, and provide exact export instructions when needed. Export files may contain secrets: track their lifecycle and provide deliberate cleanup after verified import, without deleting original vault data automatically.

For Gmail, use server-side search with `gmail.readonly` and retrieve selected metadata headers where sufficient. The `gmail.metadata` scope does not support the `q` search parameter. Implement full pagination, configurable date/category scope, and explicit Spam/Trash inclusion. Persist history cursors only after processing is durable; an expired history cursor requires resynchronization. Prefer incremental polling for this local tool unless existing infrastructure justifies Pub/Sub.

For Microsoft Graph, request the least privilege needed by the implementation; delegated `Mail.ReadBasic` can support basic message discovery. Escalate to `Mail.Read` only for functionality that requires it. Follow complete next-page URLs. If using delta synchronization, account for its folder scope and supported query restrictions.

Stream local archives; do not load entire mailboxes or attachments into memory. Parse MIME headers correctly and bound message/header sizes. Start with metadata/subject evidence, make deeper content inspection a scoped capability, and never execute message content or fetch remote email images. Exclude raw subjects, bodies, reset URLs, verification codes, and attachments from ordinary reports.

Expose per-source coverage: configured, connected, scanned, incomplete, skipped, unsupported, failed, and requires-user-action; last successful scan; filters/date coverage; cursor freshness; and counts. A failed or partial scan must never become a successful empty result.

# 8 Identity reconciliation and evidence

Model source evidence separately from confirmed accounts. Retain source references, timestamps, evidence categories, confidence reasons, and the status of verification. A sender domain alone does not prove an account, an official website, or the destination where a credential may be entered.

Handle mail vendors, guest receipts, spoofed messages, forwarded mail, shared inboxes, multiple recipients, email aliases, recycled addresses, tenant-specific subdomains, and multiple accounts on the same service. Public-suffix-aware normalization can suggest relationships, but must not automatically merge unrelated tenants or service accounts. Preserve exact username distinctions unless a provider-specific equivalence rule is established.

Match against vault items using verified service identity, relevant URL/origin rules, account identity, and explicit aliases. Separate exact matches, possible matches, conflicts, and unmatched evidence. A matching vault entry does not prove its password works. An unmatched email clue does not prove that a password is missing.

Track password, passkey, social sign-in, enterprise SSO, magic-link/passwordless, hardware-key, and unknown authentication methods. Do not create standalone passwords for SSO/passkey-only accounts simply to satisfy the model. Preserve linked identity-provider relationships and explain which credential actually controls access.

Provide efficient review and reconciliation: batch obvious decisions, searchable evidence summaries, stable identities, reversible metadata decisions, and a way to record verified domain/account mappings. Unconfirmed email clues must never automatically become credential-bearing vault items or password-change destinations.

# 9 Credential import and migration

Build a resumable migration workflow that inventories source items, determines field support, proposes creates/updates/conflicts, executes selected changes, and verifies the result.

Use application-level reconciliation rather than blindly rerunning `bw import`: the documented importer does not deduplicate. Maintain durable source-item-to-vault-item mappings and stable operation identities. Handle the case where a create succeeded but its response or checkpoint was lost. Reconcile the existing vault before retrying an uncertain write.

Avoid replacing a current credential with an older export just because its domain matches. Surface conflicts and preserve both candidates through the encrypted secret facility until resolved. Preserve names, usernames, URI lists and matching rules, folders, notes, custom fields, TOTP material, ownership, passkeys, attachments metadata, and other unrelated supported fields.

Detect unsupported or nonportable fields before mutation. CSV password import must not be presented as complete passkey or attachment migration. Use supported credential-exchange/app workflows where available and generate exact actions for the remainder. Report item-level imported, preserved, conflicted, failed, and requires-action status; do not silently drop data.

Use the freshest vault object for updates. Bitwarden's `edit` operation replaces the object, so preserve unrelated fields and detect intervening edits. Do not assume the CLI provides atomic compare-and-swap. Use locking, preflight comparisons, readback, and explicit reconciliation where guarantees are limited.

Never print full CLI responses containing credentials. Prefer supported stdin/secure input channels to secret-bearing process arguments. Leave source files and original vault data intact until verification; deletion of old stores, duplicate items, or browser records must be a separately selected cleanup action with recovery implications explained.

# 10 Health checks and prioritization

Provide a unified audit that distinguishes weak passwords, reuse, known exposure, invalid/stale credentials, incomplete migration, unknown MFA, recovery readiness, and connector failures.

Use supported Bitwarden health functionality when available. Current CLI documentation includes `bw report password-health` and an option to skip network exposure checks; detect actual version/plan capability. An unavailable report or network failure means unknown, not healthy. Any local fallback must explain its limitations and avoid persisting crackable password-derived fingerprints in ordinary metadata.

Use documented privacy-preserving mechanisms for password-exposure checks. Account breach lookups are separate, incomplete evidence. Never send raw passwords, vault exports, or entire mailbox contents to analysis services.

Prioritize exposed/reused credentials and high-impact accounts such as primary email, identity providers, banking, domain registrars, source control, cloud hosting, and infrastructure administration. Make priorities configurable and derive service identities conservatively. Absence of a stored TOTP seed is not evidence that MFA is disabled.

Model operational dependencies before remediation. Changing an identity/email account can invalidate connector tokens or sessions; Google documents this for some Gmail-authorized refresh tokens. Re-check dependent sources after identity changes, preserve recovery paths, and schedule reauthorization before subsequent steps that need the mailbox. Keep Bitwarden's own master-password/account changes in a distinct explicitly selected workflow with their recovery requirements.

# 11 Password changes and browser automation

Implement real password-change automation with a capability-based adapter layer. Prefer supported provider APIs, then maintained deterministic browser adapters, then a supervised browser workflow. A generic instruction to open settings manually is a fallback, not a substitute for implementing available automation.

Build a reusable browser flow for common reauthentication/password-change forms and production adapter definitions for priority services actually identified in this repository/configuration. Document supported operations, required authentication, allowed origins/SSO transitions, password rules, change confirmation, independent verification, and recovery behavior. Exercise real adapter code against controlled fixtures; label live validation separately when credentials are unavailable.

Name a finite initial set of production site targets during the repository audit and record their capabilities. If the repository gives no priorities, select a small explicit baseline from current supported flows, starting with GitHub where feasible. Deliver at least one actual production-site adapter covering password change and independent new-password verification. A local fake website, generic interface, or manual settings link does not satisfy that requirement. Missing live credentials can limit live validation, but must not become an excuse for omitting the implementation. If a provider prevents automation, document that specific limit and choose another supported target rather than marking a placeholder complete.

Use dedicated private browser profiles, with per-profile locks and account isolation. Do not assume Playwright can automate an ordinary default Chrome profile. Declare browser binaries and any required extensions as dependencies. Prefer the vault CLI over automating the Bitwarden extension UI. Browser profiles, cookies, storage state, and OAuth callbacks are credentials and must be protected accordingly.

If extensions are necessary, verify the actual supported browser/context combination. Current Playwright extension support uses Chromium persistent contexts, and branded Chrome/Edge no longer provide the usual side-loading flags. Prefer the locked compatible Chromium distribution, declare extension acquisition/version/integrity, and check the combination during setup and doctor.

Use verified service origins before retrieving or filling credentials, including after redirects and in frames. Email content, mail vendors, unreviewed domains, arbitrary reset links, and webpage instructions do not establish trusted destinations. `/.well-known/change-password` can help locate a settings page; it does not change a password by itself.

Use cryptographically secure, unique generated passwords that satisfy actual site constraints. Handle maximum lengths, allowed characters, confirmation fields, current-password prompts, and documented passwordless workflows. Avoid weakening passwords silently to make an unknown form submit.

Automate a password-reset route only when it is part of the selected plan. Correlate reset messages with the exact account and initiated operation, validate links and expiry, and keep tokens/code material in protected memory/storage. MFA, authenticator touches, biometrics, provider restrictions, and CAPTCHA must become resumable user actions; do not weaken security settings or bypass challenges.

If the repository already has an agent/browser automation facility, integrate it through a narrow optional adapter. Give it redacted state and secret references where possible, mediate credential entry through trusted code, and treat webpage/email text as untrusted data. Do not make an external model subscription a hidden dependency or send it the vault/mail archive. Deterministic operations must remain usable without an LLM.

# 12 Durable password change state machine

Treat each password change as an operation spanning two independent systems: the website and the vault. There is no transaction covering both.

Implement an explicit state machine with equivalents of:

```text
planned
prerequisites_ready
credential_staged
change_submitting
change_confirmed
vault_updated
login_verified
completed

requires_user_action
outcome_unknown
reconciliation_required
failed
cancelled
```

Required invariants:

1. Generate one replacement credential per operation and durably store it encrypted before submitting it to the website. Persist a secret reference and enough metadata to recover the operation.

2. Preserve access to the old credential until the outcome is reconciled. Use the existing secret system; do not build another general-purpose vault.

3. Persist intent before an external side effect. A filled form, button click, or navigation is not proof of a successful change.

4. A timeout, crash, cancellation, or connection loss after submission can mean unknown outcome. Do not blindly resubmit or generate another replacement.

5. On resume, reconcile whether the old or staged credential is active using bounded attempts and adapter-specific evidence. Respect lockout/rate limits. Uncertainty must remain visible.

6. If the website changed but the vault write failed, retain the staged credential and prioritize completing or reconciling the vault update.

7. Read the current vault item before mutation, preserve unrelated fields, and detect conflicts with other devices/processes. Re-read after writing to verify the intended credential and metadata survived.

8. Verify the new password through a fresh authentication flow that does not inherit an already authenticated session or succeed through SSO/passkey fallback. If MFA blocks verification, retain an explicit pending verification action.

9. Mark completion only when website authentication and current vault storage are both established. Keep provider-attested, user-attested, and independently verified evidence distinct.

10. Do not claim automatic rollback after a remote password change. Recovery may mean finishing the new state or initiating a guided provider recovery flow.

11. Release locks and clean temporary state without deleting secrets needed by incomplete operations. Purge obsolete staged material only after verified completion and the configured retention policy.

Crash recovery is a core feature, not a later enhancement. Exercise interruptions before and after every durable write and external side effect.

# 13 Manual actions with exact continuation paths

Every manual step must be a structured, persistent workflow action rather than an unstructured log message. Include:

- The account/source, operation, run, and current step.

- The specific reason automation is blocked.

- The verified official destination or the relevant local dialog.

- Numbered instructions tailored to the detected provider, OS, and browser.

- The exact selection, entry, consent, touch, or confirmation required.

- Prerequisites and any relevant expiry.

- What the tool will detect to establish completion.

- A precise resume command and an alternative if the preferred authentication route is unavailable.

- Which operations are blocked and which can continue independently.

For example, an OAuth-consent action should open the correct authorization flow, identify the selected account and requested read-only access, wait for a validated callback when interactive, and persist an action with a resume command when headless. “Set up OAuth” is not an adequate instruction.

Support listing, inspecting, reopening, retrying, skipping with a recorded reason, and resolving actions. Re-check preconditions and actual completion when resuming; a user clicking “done” must not automatically convert an unverified credential into a verified one. When independent verification is impossible, record user attestation honestly.

Preserve relevant browser state securely across a pause and restart. Reuse already completed setup and granted authorization. Provide one clear next action at a time without repeatedly asking for approval for the already selected plan.

# 14 MFA passkeys recovery and account cleanup

Treat password rotation, MFA enrollment, factor replacement/removal, passkey enrollment/transfer, recovery-code regeneration, and account deletion as separate capabilities and plan actions.

Automate supported enrollment and verification steps, with clear user actions for authenticator touch, biometrics, scanning, or provider confirmation. Follow the user's existing authenticator strategy instead of automatically moving every factor into Bitwarden. Store recovery codes and seed material only in the selected encrypted destination.

Verify a replacement factor or recovery mechanism before proposing removal of an existing one. Recognize that many passkeys/hardware credentials are not exportable through a password CSV or generic CLI; use actual supported exchange/enrollment mechanisms and report incomplete transfers explicitly.

Apply durable intent, encrypted material capture, unknown-outcome handling, verification, and reconciliation to factor changes and recovery-code regeneration too. Regeneration can invalidate the previous code set. Securely retain newly issued material before treating the operation as complete, and never blindly repeat an ambiguous regeneration or factor-removal request. Adapt staging to what the provider actually returns; do not pretend new server-generated codes can be known before issuance.

Track recovery email/phone dependencies and whether a recovery route has been checked, without presenting a reminder as proof that recovery works. Provide a guided emergency-recovery preparation flow that does not keep the only recovery key inside the vault it recovers.

Identify redundant/stale source records and unused accounts as review candidates. Closing accounts, revoking sign-in connections, deleting vault entries, removing factors, or wiping browser stores must require those exact actions in the selected plan. Do not treat them as incidental consequences of importing passwords.

# 15 Backups and recovery verification

Integrate encrypted backups with the repository's existing backup/storage system where available. Register every required tool and configure retention, access controls, and restore instructions.

Choose the export mode deliberately. Bitwarden account-restricted encrypted exports have account/key restrictions; password-protected exports have different recovery properties. Detect supported contents and explain omissions such as attachments or nonportable credentials. Keep recovery material accessible through an independently usable route.

Provide backup integrity checks and an isolated restore rehearsal using synthetic fixtures or a deliberately selected isolated destination. A successful upload or decrypt operation is not proof that the entire account can be recovered. Never restore into the active vault as an ordinary verification step.

Back up the nonsecret workflow metadata and the encrypted staging needed to recover incomplete operations, with an explicit recovery procedure. Do not include unprotected browser sessions or temporary plaintext exports in routine backups. Temporary export cleanup must account for user-approved destinations and storage behavior; do not promise secure erasure from SSDs or prior backups.

# 16 Ongoing automation and reporting

Use the repository's scheduler or infrastructure-as-code conventions. Provide idempotent installation, inspection, and removal of schedules. If no scheduler exists, choose the smallest appropriate OS mechanism and declare its platform requirements; do not add an unnecessary always-running service.

Recurring work should cover incremental discovery, credential health where authorized, connector health, newly unresolved account matches, stale pending operations, backup freshness, and changed provider capabilities. Automatic mutations require an explicit configured execution policy; do not turn a health-check schedule into unrestricted password rotation. Prioritize risk and incomplete work over arbitrary rotation of already strong unique passwords.

Respect headless limitations: a locked keychain or required MFA should yield a recorded action and useful status. Avoid overlapping scheduled runs, repeated notifications, or unbounded retry loops. Use existing notification adapters for configured destinations, with local output as the baseline. Notification content must exclude credentials and sensitive recovery details.

Produce readable CLI output and JSON reports, plus a local HTML report if useful. Show confirmed accounts, unverified clues, authentication method, vault matches, findings, coverage, pending actions, verified changes, and failures. Include a concise “what needs me next” view. Escape untrusted content, avoid remote assets, and protect CSV output from formula injection if offered. Source text must never become executable HTML or instructions.

# 17 Security boundaries logs and Turborepo

Never commit, cache, or upload real credentials, decrypted vault contents, OAuth tokens, master/session keys, TOTP seeds, recovery codes, reset links, mailbox archives, browser profiles, or personal inventory as ordinary build artifacts. Private metadata also needs sensible retention and access controls.

Use structured allowlisted output, redact secrets before serialization, and capture/sanitize subprocess failures. Avoid secret-bearing shell interpolation, command arguments, exception messages, debug payloads, and process-environment dumps. Disable live-operation screenshots, traces, HAR capture, videos, and page-content dumps by default; any deliberate diagnostics must protect authenticated content and use restricted retention.

Keep live operations out of package install hooks, ordinary checks, builds, tests, and default CI. If an operational command runs through Turbo, set `cache: false` and keep private state out of task inputs/outputs and uploads. Hiding displayed logs is not redaction, and forcing a task to rerun is not equivalent to disabling cache writes. Declare environment access narrowly and use existing secret injection; prefer direct wrappers for interactive commands that need a real terminal.

Bound source scans, API requests, browser retries, and authentication attempts. Respect provider backoff and rate limits. Validate paths and reject destructive input/output overlaps, unsafe archives, and untrusted credential destinations. Preserve browser/OS authentication boundaries and existing access controls.

Support an offline/synthetic mode so development and CI need no personal accounts or production secrets. Keep live tests separately invoked with dedicated test accounts and clear scope; never mutate my real accounts to demonstrate that implementation is complete.

# 18 Testing and acceptance evidence

Use the repository's existing test stack. Add meaningful property-based/state-machine tests where they improve coverage, especially for identity reconciliation, idempotency, and operation recovery. Reuse existing deterministic simulation facilities if present instead of creating a parallel framework.

Provide fake vault/email/secret-store adapters and local fixture websites exercising the same production orchestration code. Include password forms, reauthentication, delayed responses, successful submission followed by disconnect, MFA handoffs, expired sessions, rate limits, and concurrent edits. Keep fixtures synthetic and clearly distinguished from live-provider validation.

Required scenarios:

1. A clean supported machine/CI environment installs all declared dependencies without relying on undocumented globals.

2. Repeated setup and dependency checks are idempotent; doctor identifies a missing browser, missing native library, wrong executable, locked vault, insufficient scope, and expired connection accurately.

3. Repeated discovery and import create no duplicate accounts or vault items; a lost create response is reconciled before retry.

4. Email vendors, forwarded/guest receipts, aliases, multiple recipients, multiple usernames, tenant domains, and SSO-only accounts do not create false verified identities.

5. Large/malformed archives, MIME-encoded headers, quoted CSV fields, unsupported export contents, partial pagination, and expired cursors behave correctly without leaking payloads.

6. A stale source export never automatically replaces a current credential. Detect and reconcile concurrent changes visible through the available APIs, preserve unrelated fields, and serialize package-owned writes. Document residual external-edit races where atomic conditional writes are unavailable instead of claiming a stronger guarantee.

7. Process termination at every rotation boundary preserves access to the staged credential and resumes the same operation.

8. Remote success followed by timeout, vault failure, or lost acknowledgement yields reconciliation, not blind resubmission.

9. Existing signed-in cookies, SSO, or a passkey cannot falsely prove that the replacement password works.

10. MFA/consent/challenge actions survive process restart and resume without restarting completed independent work.

11. Identity-provider rotation invalidating mailbox access produces reauthorization and preserves downstream work.

12. Two processes cannot operate on the same account/profile concurrently, and stale locks have a deliberate recovery path.

13. Secret canaries placed in credentials, notes, OTPs, reset URLs, email content, CLI errors, and browser errors never escape into ordinary reports, logs, traces, caches, or test artifacts.

14. Malicious page/email instructions and cross-origin redirects cannot control the operation or receive credentials.

15. Backup verification uses an isolated destination, establishes the tested recovery properties, and does not alter the active vault.

16. Cancellation, partial failure, unsupported capabilities, expired authorization, and headless user-action requirements produce accurate status and exact continuation instructions.

Run the package's checks and the repository's required affected-package checks. Broaden verification to resolve concrete integration risks, not to perform unrelated cleanup. Distinguish implemented-and-tested, fixture-tested, and live-verified behavior in the final report.

# 19 Delivery sequence and definition of done

Work in coherent phases while delivering the complete scope:

1. Repository integration, declared toolchain/system dependencies, durable state, secret boundary, CLI, setup, and doctor.

2. Real source connectors, incremental discovery, evidence/identity reconciliation, vault comparison, migration, and health.

3. Browser/site adapters, durable password-change execution, verification, manual-action resume, and authentication/recovery workflows.

4. Backups, schedules, reporting, cleanup, documentation, failure testing, and monorepo verification.

Do not finish after phase one or replace production adapters with empty interfaces. If live authentication or a provider restriction prevents a live run, complete the implementation, synthetic verification, capability detection, and exact onboarding/resume path. Clearly identify the remaining external action. Unsupported provider behavior must be distinguished from unfinished implementation.

Deliver:

- The integrated `password-manager` package and root commands.

- All dependency/provisioning/lockfile changes, including system and browser requirements.

- Validated configuration with safe example values and secret references.

- Real adapters and an honest capability matrix.

- Durable plans, operation recovery, and structured manual actions.

- Tests/fixtures and passing relevant checks.

- Documentation covering first run, source connection, migration, password changes, pause/resume, troubleshooting, backups, upgrades, scheduling, and cleanup.

- A maintainer guide for adding sources/sites, including contract expectations and fixture tests.

The first-run documentation must provide one exact repository command to start. Every expected manual prerequisite must include a concrete numbered path and a way to continue. A fresh checkout plus declared provisioning should be sufficient to reach onboarding.

Finish your implementation response with: what was built; the exact setup/run commands; the supported automation matrix; checks actually run; any unverified live integrations; and any unavoidable user actions with their resume commands. Include relevant file paths. Do not claim accounts were imported, changed, or secured unless those operations actually ran and were verified.

# 20 Official references to verify during implementation

Check current official documentation against the repository's pinned versions. These links describe capabilities and constraints; the architecture, invariants, and acceptance criteria above are implementation requirements.

- [Bitwarden Password Manager CLI](https://bitwarden.com/help/cli/)

- [Bitwarden import behavior and supported transfer paths](https://bitwarden.com/help/import-data/)

- [Bitwarden password-change workflow](https://bitwarden.com/help/change-at-risk-passwords/)

- [Bitwarden encrypted exports](https://bitwarden.com/help/encrypted-export/)

- [mise lockfiles](https://mise.jdx.dev/dev-tools/mise-lock.html)

- [mise OS package bootstrap](https://mise.jdx.dev/bootstrap/packages/)

- [mise project diagnostics](https://mise.jdx.dev/configuration/project-diagnostics.html)

- [Turborepo caching](https://turborepo.dev/docs/crafting-your-repository/caching)

- [Turborepo environment handling](https://turborepo.dev/docs/crafting-your-repository/using-environment-variables)

- [Playwright browser binaries and system dependencies](https://playwright.dev/docs/browsers)

- [Playwright browser profiles](https://playwright.dev/docs/api/class-browsertype)

- [Playwright extension support](https://playwright.dev/docs/chrome-extensions)

- [Playwright authentication state](https://playwright.dev/docs/auth)

- [Gmail message search and pagination](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/list)

- [Gmail scopes](https://developers.google.com/workspace/gmail/api/auth/scopes)

- [Gmail incremental synchronization](https://developers.google.com/workspace/gmail/api/guides/sync)

- [Google desktop OAuth](https://developers.google.com/identity/protocols/oauth2/native-app)

- [Google OAuth token lifecycle](https://developers.google.com/identity/protocols/oauth2)

- [Microsoft Graph message discovery](https://learn.microsoft.com/en-us/graph/api/user-list-messages?view=graph-rest-1.0)

- [Microsoft Graph message delta synchronization](https://learn.microsoft.com/en-us/graph/api/message-delta?view=graph-rest-1.0)

- [Google linked accounts](https://support.google.com/accounts/answer/13533235?hl=en)

- [Apple linked accounts](https://support.apple.com/en-us/102571)

- [Password-change URL discovery working draft](https://www.w3.org/TR/change-password-url/)
