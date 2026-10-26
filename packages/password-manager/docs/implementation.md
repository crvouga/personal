# Implementation and evidence ledger

The authoritative scope is [`implementation-prompt.md`](implementation-prompt.md),
beside this ledger. This ledger records decisions, delivery scope and acceptance evidence.

## Repository audit and decisions

- Flat `packages/*`, private `@pkgs/*`, Bun 1.4.4, Node 22.22.3 from root mise.
  No repository-pinned mise release or mise lock currently exists. Avoid new
  bootstrap/diagnostics features requiring an undeclared mise version.
- Root strict TypeScript, shared ESLint structural limits, Prettier, Bun tests.
- Node 22.22.3 `node:sqlite` was directly exercised (SQLite 3.51.3).
  The original Bun 1.3.11 audit lacked that module. Bun 1.4.4 exposes it,
  but SQLite integration tests retain the exercised managed Node runtime;
  pure domain/adapter tests use the usual Bun stack.
- Reuse `SecretStore` and `SecretString`. Existing Vault adapter is read-only;
  runtime staging must not mutate OpenTofu-owned Vault values. Implement the
  existing port using the OS persistent credential store; no custom vault.
- Isolate all private state in the OS application-state directory, never repo,
  synchronized checkout, build outputs, Turbo inputs or remote caches.
- Resolve bw from a locked local npm dependency, never global PATH; isolated
  bw appdata. Playwright owns its matching Chromium; no extension required.
- Existing schedules are remote platform maintenance, unsuitable for local
  personal vault/mail. Use a local launchd agent/systemd user timer. No server,
  cloud resource, hosting inventory change or secret seeding is required.
- Initial production targets: GitHub deterministic password form + independent
  password login, Google/Apple linked-sign-in read-only guided reviews; Railway,
  Cloudflare, Google and Bitwarden account/factor changes have separate guided
  capabilities until provider-specific independent verification is established.
  GitHub is present throughout repository publisher/CI/hosting configuration.
- Every live operation runs through direct CLI wrappers outside Turbo. Default
  test/check/build paths use synthetic credentials only.

## Execution plan

1. Integrate package/bin/root commands and locked dependencies; implement strict
   configuration, private SQLite migrations/locks, OS secret adapter, durable
   action records, bootstrap and read-only doctor.
2. Implement real Bitwarden, CSV/JSON, streaming mail, Gmail, Graph, IMAP and
   inventory adapters; coverage/cursors; conservative identity reconciliation,
   idempotent import/readback and audit.
3. Implement durable rotation/recovery with staged credentials and the production
   GitHub browser adapter; trusted origins, fresh verification and challenge
   handoffs; explicit authentication/recovery action capabilities.
4. Implement encrypted backup/rehearsal, local schedules, retention/cleanup,
   reports and integrated CLI; fixture/failure/security tests and operator and
   maintainer documentation; run all affected checks.

## Verification status

No live account authentication, import, rotation,
backup, factor change or recovery has been performed. Keep fixture, package and
live evidence distinct as work proceeds. The full completion audit must include
all numbered acceptance scenarios in the source prompt.

## Checkpoint: implemented and verified locally

- Private workspace package, root/bin/cold-start commands, exact dependencies and
  frozen lock. Node/CI now share .nvmrc 22.22.3; existing root mise pin preserved.
  Every Docker build's workspace manifest list includes the new package, guarded
  by scripts/workspace-manifests.test.ts. No cloud resources were changed.
- SQLite metadata transactions, schema version refusal, owner-only paths,
  process-owned locks and dead-owner recovery. Existing SecretStore port backed by
  persistent OS credentials; no runtime writes to OpenTofu-managed Vault inputs.
- Real local export/archive/inventory/confirmed-account, Bitwarden, Gmail, Graph
  and IMAP adapters. Gmail and Graph now return durable continuation offsets when
  message bounds interrupt pagination. Custom Gmail queries deliberately use full
  server-search polling rather than pretending history applies arbitrary q filters.
- Conservative evidence/account separation; selected idempotent import with
  durable markers and readback. Password staging, submission intent, uncertain
  outcome reconciliation, current-vault preflight and independent verification.
- Initial production GitHub adapter exercised against a controlled form server;
  no production account credentials used. Cross-origin forms rejected before fill.
- Encrypted backup container, isolated SQLite rehearsal, local schedule definitions,
  pending actions, guided factor/code-capture workflow, cleanup, documentation and
  synthetic end-to-end CLI demo.
- Real SIGKILL tests across process restart pass at old/replacement secret writes,
  state transitions, remote password write and vault write. A separate live worker
  proves account-lock exclusion and dead-owner recovery.
- Actual locked bw 2026.10.0 was invoked using isolated temporary appdata, without
  login or network account mutations. Its unauthenticated status omits email and
  has null serverUrl; the adapter normalizes these rather than assuming strings.

Checks already run successfully during implementation:

- Frozen Bun install; package strict typecheck and shared lint (no disabled caps).
- Package Bun domain/connector/OAuth fixtures, Node SQLite/import/backup/crash/CLI
  integration tests and production-adapter browser fixtures. Latest totals must be
  read from current output, since additional cases are still being added.
- Filtered Turbo tc/lint/test/build through the password-manager dependency closure
  (19 tasks passed); root check:scripts (175 tests before the additional manifest
  regression, which passed separately); check:agents and check:llms; changed-file
  Prettier and git diff --check.
- No pushed branch/PR, CI run, live account change, real-mail scan, production
  restore, OS schedule installation or live OS-secret-store write is claimed.

## Requirement audit

The sixteen acceptance scenarios and their limits are mapped in
[acceptance.md](acceptance.md). Current requirements are implemented for the
finite capability set documented in the operator guide; live validation remains
separate from implementation and synthetic verification.

| Prompt sections                    | Delivered implementation                                                                                                                                                                                                                                                                                                                                                           |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1–3: workspace and dependencies    | Flat private workspace package, root/bin/cold launcher, root mise pins, frozen npm lock, explicit local executable resolution, declared OS/Chromium ownership and upgrade workflow; actual clean Ubuntu cold-start and repeated setup test                                                                                                                                         |
| 4–6: architecture, CLI, setup      | Strict ports/adapters, private SQLite/version refusal/transactions and process locks, protected OS credential subprocess, versioned config, read-only doctor, installed-app PKCE loopback consent, exact Bitwarden identity/unlock separation and onboarding actions                                                                                                               |
| 7–8: discovery and identity        | Real vault, CSV/JSON, MBOX/EML, Gmail, Graph, TLS read-only IMAP, confirmed/inventory adapters; bounded continuation/coverage, native export metadata detection, reversible/batch explicit mappings and aliases                                                                                                                                                                    |
| 9–10: migration and health         | Selected creates/updates/preserve, lost-response reconciliation, current-cache sync, fresh-object preflight/readback, metadata conflict detection, folders/ownership mappings, unsupported native transfer actions, password health and unknown/stale validity distinctions                                                                                                        |
| 11–12: browser and rotation        | Production GitHub definitions plus reusable guarded form primitives, headed challenge handoff, sealed network/verified origins, persistent old/staged secret and intent, bounded reconciliation, independent fresh password acceptance, revision-sensitive verification and account/vault locks                                                                                    |
| 13–14: actions, factors/recovery   | Durable scoped instructions, retry/reopen/skip/attestation, provider-specific Google/Apple/GitHub paths, issued-code intent/capture/readback, tested replacement plus exact factor-label removal gate, linked-account review, emergency preparation and mailbox reauthorization dependencies                                                                                       |
| 15–16: recovery and maintenance    | Independently password-encrypted config/items/folders/metadata/staging archive, isolated verification/restore namespace, explicit sensitive native extraction, idempotent OS scheduler with injected fixture commands, stored summaries/backup freshness/stale-operation/capability checks, deduplicated action identity, deliberate verified export cleanup and guarded retention |
| 17–19: boundaries/testing/delivery | Explicit report DTOs, sanitized process/browser errors, private operational storage outside Turbo, synthetic default CI, real process-kill and browser/protocol fixtures, operator and maintainer guides, all sixteen acceptance scenarios mapped to evidence                                                                                                                      |
| 20: official references            | Current official Bitwarden, Gmail/Graph/OAuth, Playwright/mise/Turbo, GitHub and Google/Apple authentication guidance checked during implementation; operator/maintainer guides link the relevant constraints                                                                                                                                                                      |

## Current validation record

- Frozen installation and actual clean Ubuntu 24.04 arm64 cold-start/repeated setup
  passed. Node/Bun were absent initially. No desktop secret-store session was
  fabricated; it correctly remained locked and onboarding remained pending.
- Strict package typecheck/lint, Bun connector/domain fixtures, Node SQLite,
  migration, recovery, source, security and CLI tests, and production-adapter browser
  contracts pass when run with the declared toolchain. The final delivery response
  records the latest totals; this ledger does not freeze counts while tests evolve.
- Affected Turbo dependency closure passed 19 tasks. Root script checks passed 176
  tests; agent command links and generated integration documentation checks passed.
- CI configuration includes explicit locked Chromium/native dependency installation
  and synthetic browser contracts. No branch was pushed and no green hosted CI is
  claimed from local checks.

## Explicit live and platform boundaries

- No personal account was authenticated, imported, changed, deleted or secured.
  Mail APIs and GitHub flows have production implementations and fixture evidence;
  selected-account live validation requires the documented onboarding/consent.
- Initial automated password target: GitHub. Google/Apple factors, recovery and
  linked-inventory changes use exact native-user actions with durable protected
  material; they are not presented as unattended enrollment or independent factor
  verification. Other site origins receive a visible unsupported-capability action.
- OS keychain writes, real schedule installation and native browser exports require
  the operator's machine/session. Test seams do not claim those live interactions.
- Bitwarden's account/master-password changes, organization ownership changes,
  attachment bytes and nonportable passkeys require their distinct supported native
  workflows. Account/vault deletion is never incidental to import or cleanup.
- There is no provider-wide all-accounts discovery claim, account-breach completeness
  claim, atomic bw compare-and-swap, automatic remote rollback or secure SSD erasure
  guarantee. Coverage, unknown evidence and residual races remain visible.
