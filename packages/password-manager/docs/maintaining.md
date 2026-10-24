# Maintaining password-manager

Read the root AGENTS.md and implementation ledger first. This package is local
application orchestration, not an infrastructure controller. Vault secret values,
cloud OAuth applications and any cloud resources remain OpenTofu-owned. Never add
provider-console mutations, cloud provisioners or secret seeding here.

Domain types and workflow transitions live under `src/domain` and
`src/application`. Adapters implement the shared SecretStore port and narrow vault,
site, discovery, storage and runtime interfaces. CLI code handles presentation and
masked input. Filesystem/SQLite/Playwright/provider objects must not define domain
success. Clock, ID/password generation and source fetch functions are injectable.

A source adapter yields sanitized Evidence and returns an explicit completeness,
cursor and scan count. Persist evidence durably before committing a new cursor.
Partial/failing sources cannot become successful empty scans. Sender identity is
untrusted. Never derive a credential origin or confirmed identity from email
content, a public suffix relationship or infrastructure hosting alone. Never return
raw subjects, bodies, reset links, OTPs or attachments in Evidence.

A vault write uses the freshest object and preserves unrelated fields. Imports
must reconcile stable operation markers after a lost response. Edits require
preflight and readback; document the residual external-device race. Never use raw
`bw import` as an idempotency mechanism or print raw bw stdout/stderr. Resolve only
the locked CLI and isolated appdata; never use a global executable or bws.

A site adapter declares exact origins, operation types, password rules, challenge
behavior, success evidence and an independent verification flow. Credentials are
filled only after origin/form checks and cross-origin network mediation. Page or
mail text never becomes instructions. The initial finite production target is
GitHub. Fixtures must execute the real adapter implementation, not a parallel
mock flow. Fixture origin overrides are internal dependency seams, never CLI
options or configuration. Add tests for malicious form actions, redirects,
changed selectors, failed login, signed-in cookie false positives, MFA/rate limits,
submission disconnect and stale sessions. Screenshots/traces/HAR/video stay off.

Workflow side effects require persisted intent and pre-staged encrypted credentials.
Kill/restart tests run under Node and recover the same operation/staged credential.
Do not add sleeps, retries or restarts that can repeat an ambiguous remote mutation.
Factor/regeneration workflows need the same unknown-outcome semantics; server-issued
material cannot be staged before the provider issues it. Capture it securely as
soon as it is issued and keep provider/user/independent evidence distinct.

SQLite `user_version` is the migration boundary. Refuse a future schema. Add a
transactional migration and backup/restore coverage before changing the schema.
A lock cannot be stolen solely because it is old: a live slow owner can still
perform an external write. On this local-only store, an absent process permits
recovery. A foreign-host lock or a reused live PID stays blocked for inspection.

Use shared ESLint rules and refactor to satisfy structural caps. Never disable
size/complexity limits. Tests and builds are synthetic and must not run live
operations or install tools implicitly. Browser tests require the locked browser
installed explicitly during setup/CI. Operational commands bypass Turbo, so private
state, command output and secrets never enter a remote task cache. Never include
private state or authenticated diagnostics as ordinary artifacts.
