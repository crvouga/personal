# Compatibility and production acceptance

Status: **incomplete; inventory configures the live deployment, but production acceptance is not established**. The management architecture uses the same-domain Bun/Hono UI/API, Google-backed self-authentication, database-owned registrations and isolated Atlas-managed console schemas. Previous workflow/Tofu-client registration evidence does not establish UI/API correctness. Historical observations below describe their recorded test/deployment state, not a fresh live probe.

## Evidence and limits

The earlier private Keycloak engine suite passed locally on 2026-10-16 using Chromium, a mock upstream, shared PostgreSQL and two real replicas. It covered concurrent projects/tabs, localhost 3000/5173 and 127.0.0.1:18082, changed port 43123, unrelated test-only HTTPS domains, rejected callbacks, one-replica login failover, signing-key overlap, upstream 503, local sessions during broker outage and failed client-policy updates. **These engine tests register disposable fixture clients with OpenTofu; they are not tests of UI-created application integrations.** Port 8080 was occupied and was not disturbed; CI is configured for that port, but no local pass is claimed.

The new console suite in `tests/console.ts` passed locally on 2026-10-16 with actual PostgreSQL, Atlas through OpenTofu, Keycloak and Chromium against a mock Google upstream. Verified: Google-backed console login; nonoperator denial; atomic one-time operator bootstrap; CSRF rejection; database registration; invalid callback preservation; stale-edit rejection; injected private registration-provider outage preserving the previous valid client; exact-port updates and rejection; revocation; console session/registration persistence across a Bun service restart; an unrelated schema retained by the Atlas migration; UI-form registration; and two independent SSR fixtures authenticating on localhost:3000 and localhost:5173 through the Hono gateway. Application A's local session remained usable after its relay registration was revoked. This verifies a Bun service restart, not a production container rollout or total Keycloak cache loss.

Completed local checks include the Bun production image build, package typecheck/lint/build and callback policy tests, full `bun run check:infra` (including seven Vault gates and schema/provider checks), infra health unit tests, 47 repository-script tests, formatting and generated-doc/agent checks. The live read-only health report correctly fails for the two new setup tokens not yet applied to Vault. These checks are not green CI or a live Google sign-in. The final extended two-replica engine suite also passed locally with `AUTH_TEST_PORT_C=18082`, including revocation isolation, failed-update preservation, upstream outage, initiating-replica termination during login, and established application sessions through complete broker outage. The console provider-outage assertion passed in that same final run. Exact port 8080, live Google, the real hosting platform and other browser engines remain unverified. The production runtime image also passed an import/UI-bundle smoke check; this is not a deployed-container restart test.

The explicit fixture development command was also verified locally on 2026-10-16 without
managed AUTH settings or Vault access: local schema/bootstrap, labelled mock sign-in,
PKCE callback, operator setup, protected UI, and client creation/revocation
passed. Restarting on a different application port retained the operator and
updated the system client's exact callback through the local OpenTofu root.
Readiness returned HTTP 200 through the root Turborepo dev command on port 8081.
These are mock development results, not Google/deployment acceptance evidence.

The repeatable `bun run check:dev` acceptance also passed on 2026-10-16 through
the real root Turborepo command: fresh PostgreSQL/schema/system identities,
portfolio live GitHub data, the explicitly synthetic fleet dashboard,
Vault-authenticated cache access and a read-only R2 miss, browser OIDC sign-in,
operator setup and client registration. A full stop and restart on another
callback port retained the operator/client and allowed sign-in and revocation.
Shutdown released the instance lock and stopped owned containers without Turbo
force-killing tasks; the test removed only its disposable volumes/state. A
separate read-only sign-in against the existing default dataset passed at 8081.
The stopped-Colima bootstrap path was exercised on this Apple Silicon host;
port-conflict checks cover both loopback and wildcard listeners. These local
checks do not replace any production gate below.

Managed-data development was checked on 2026-10-16 after making fixtures opt-in.
The local Fleet API and deployed Fleet API both returned HTTP 200 with zero
registered nodes, matching the managed database. Local anonymous access remained
unauthorized; its dashboard showed the live-data label. A second local startup
passed the same read-only comparison. The isolated server regression verifies
that local startup preserves old heartbeat history instead of launching pruning.
Fleet's 572 tests and 25 browser scenarios passed, along with auth's 16 tests.
Managed auth startup correctly failed with missing deployed settings and no
fixture fallback; this is a deployment blocker, not live Google evidence.

Managed startup preflight was subsequently verified against the actual Vault:
all six relay runtime/bootstrap fields are absent in each scope. Hostname, realm
and private upstream now resolve from canonical inventory rather than appearing
as missing local settings. Scope/environment mismatch is rejected. Auth's 20
unit tests and nine relay health tests passed. This improves configuration and
blocker reporting; it does not establish live authentication or deployment.

Fleet's Google-only consumer integration was verified locally on 2026-10-16:
OIDC code/S256 PKCE/state/nonce, explicit ID-token signature validation,
PostgreSQL-backed login/session persistence, verified-email allowlist management,
nonmember denial with working sign-out/account selection, cross-origin CSRF
rejection, callback replay/expiry, concurrent tabs, session context isolation,
revocation and concurrent final-account protection. Chromium followed real
HTTPS mock-relay redirects using independently signed tokens. Fleet's 555 tests
and 25 browser scenarios passed; the installer/API chain passed all nine tests;
the full local `bun run check` passed all 46 tasks, including 578 fleet tests.
The old Vault password-login implementation and its obsolete tests were removed;
Vault remains a secret store. The Google provider's verified-email assertion is
now trusted without enabling automatic account linking; inspect existing
unverified broker users during adoption. The updated real Keycloak/Google
integration and live rollout remain unverified. No live schema, client or
allowlist data was applied or seeded. Nix/VM checks were not run.

The React/Mantine console replacement was checked locally on 2026-10-24 with
43 passing auth unit/render/request tests, package typecheck/lint/production build,
frozen dependency installation, formatting, generated-doc and agent-link checks.
The app browser exercised the explicitly in-memory UI fixture: application
creation, immutable identity fields, failed-save draft/settings preservation,
successful callback edits, confirmation before revocation, operator addition,
integration navigation, first-operator setup, nonoperator denial, signed-out
labelling and service-unavailable recovery. Motion was disabled only in the
temporary test page because the background WebView pauses animation frames;
this does not verify animations or the cross-browser/mobile matrix. These
checks used no managed database or real provider and do not establish live
Google sign-in, a deployed image, or production readiness. The existing
provider/database console suite was updated for the registration drawer but was
not rerun as part of this UI change.

The appearance follow-up adds persistent Light/Dark/System selection (System by
default), an external theme bootstrap before CSS, theme-aware recovery pages,
stronger text contrast, keyboard navigation semantics, reduced-motion support
and dirty-editor close/reload safeguards. The 47 auth tests, typecheck, lint and
production build passed locally. Browser fixture checks verified dark/light
selection, reload persistence, real cross-tab synchronization, System matching
the current OS setting, signed-out theme controls, route titles/skip-to-content,
and keeping/discarding a dirty registration without changing its saved data.
Blocked storage and alternate OS preferences were exercised in bootstrap tests;
changing the host OS appearance and mobile viewport rendering were not exercised.
Draft-dialog checks used the same temporary motion suppression described above.

The scoped agent integration follow-up was checked locally on 2026-10-24:
54 auth unit/render/request/client tests, auth typecheck/lint/production build,
178 repository-script tests, generated guide/agent checks and `check:infra`
passed. The Vault root's 14 mocked-provider tests verify isolated credential
paths, exact repository/subject bindings, independent generation/rotation metadata,
rejection of unsafe ids/mismatched or wildcard subjects, and shared-policy exclusion.
The existing `dev-read` policy was narrowed from all KV documents to `personal/*`;
this is a source change awaiting a reviewed Vault apply.

The full disposable PostgreSQL/Atlas/Keycloak/Chromium suite passed, including
the new agent API checks: browser/console authorization separation, project,
environment, callback and expiry scopes, manual-client and cross-grant ownership
denial, stale revisions, changed exact ports, provider-failure preservation,
in-place credential rotation, revoked/expired credential denial and audit records.
The existing engine scenarios also passed on their default ports, including 8080,
two unrelated fixture HTTPS domains, signing-key overlap, initiating-replica loss
and established consumer sessions through total broker outage. These use a mock
upstream, never live Google. The standalone client tests verify pending-identity
reconciliation, credential-free output, changing callbacks, grant-capped default
leases and refused credential forwarding on redirects. A final console run also
verified the operator **Agent access** form creating a grant from only a fingerprint;
it used `AUTH_CONSOLE_PORT_A=43124` because another application had subsequently
occupied port 3000. The earlier full default-port suite passed before that conflict.
No managed schema, Vault credential/policy, scope grant or deployment was changed;
the public site's generated files must still ship through the normal workflow.
Whole-repository formatting reported an unrelated `packages/admin-ui/sync.ts`
formatting issue; affected auth/documentation files passed their formatting check.

## Remaining production gates

1. Complete Keycloak's OpenTofu-owned initial table/changelog migration and safe version upgrade path. Production currently validates an existing schema rather than initializing it. Apply Atlas only with its isolated search_path; test runtime-role denial of cross-schema writes and backup restoration.
2. Deploy private identity services, bootstrap realm/system clients and the correct fixed Google callbacks. Apply the Vault root's new setup credentials and system/database credential projection, then deploy the public gateway. No live mutation has been performed here. Google credentials were observed in both Vault documents; new setup credentials have not been applied, and health correctly reports their absence.
3. Verify the UI with live Google, authorized operator onboarding/recovery, expired previews, provider-write/network/DB-commit failures, concurrent stale edits and reload/retry recovery. Validate scoped agent registration, startup and preview lifecycle automation live. The standalone helper supports exact callbacks on changing ports; frameworks must supply their actual bound port. Local scoped-delegation tests are not live project-owner acceptance.
4. Authenticate at least two independent consuming applications through UI-created clients on unrelated owned public domains, multiple concurrent localhost ports (including 8080), staging/production and previews. Test code redemption, CORS for browser apps, SSR cookies and per-instance sessions. Run Chrome, Safari, Firefox and Edge; test-only domains and Chromium do not prove that matrix.
5. Validate actual Railway private networking, independent production/nonproduction trust boundaries, two-replica clustering, readiness/draining, rolling deployments, crash/partition recovery and backward-compatible schema rollouts. Bun transactions/sessions are durable; Keycloak in-flight sessions still depend on replicated caches. Complete cluster loss is not proven to preserve an outstanding login.
6. Validate signing, Google, console, manager and database credential rotation with overlap. Established local application sessions during outages must remain usable under each application's policy. Do not retry one-time codes.
7. Complete per-client overload/load tests, fair admission tuning, minute-resolution synthetic monitoring, alert delivery and backup restore. The shared database currently has no replica; the 99.9% objective is not an achieved SLA.

Do not enable the relay or claim production readiness until these gates have evidence. A green local check is not green CI. Do not tick unsupported attestations or ask the user for evidence solely to clear a gate.
