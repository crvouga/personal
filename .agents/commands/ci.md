---
name: ci
description: Run local checks, publish through a PR, and watch the complete CI run.
---

<!-- Canonical file; harness copies are symlinks (`bun run agents:sync`). -->

# Check & CI

Run `bun run check:ci && bun run typecheck`. Fix failures and repeat. Optional
Vault integrations report unavailable credentials without suppressing core
formatting, lint, typecheck, test, build or OpenTofu checks.

Use `/pr-ready` to commit, push and land through the protected merge queue.
Never push main directly, weaken checks, commit secrets or patch dependencies.

After publishing, watch the complete run for that commit:

```sh
bun run gh:ci:watch
bun run gh:ci:status
bun run gh:ci:log
```

A green local check is not green CI. Main-branch CI includes the called Deploy
workflow, so keep watching through image publication, OpenTofu and production
public endpoint checks. Fix failures locally, rerun checks, commit and publish again.
Report unavailable credentials or infrastructure access precisely; never turn
an unavailable check into a pass.

| Workflow     | Responsibility                                                                                                |
| ------------ | ------------------------------------------------------------------------------------------------------------- |
| CI           | Check; conditional Nix and installer tests; installer release; Fleet gate; successful main pushes call Deploy |
| Deploy       | One ordered production job: credential preflight, images, OpenTofu, readiness and public checks               |
| Maintenance  | Read-only Health, scheduled Update, explicitly manual Repair                                                  |
| Publish      | Reusable single-image publisher for application repositories                                                  |
| Runner check | Reusable project toolchain on trusted runners or hosted fallback                                              |
| Fleet enroll | Owner-approved issue enrollment with a workflow-bound Vault identity                                          |

CI runs on every PR and merge-queue entry, including documentation-only
changes. Check is the main validation status; Fleet covers platform tests and
required installer release publication. Required temporarily covers Check and Fleet while
the OpenTofu-owned ruleset migrates. Remove it only after the live ruleset
requires Check and Fleet and both have passed in the queue.

Optional secret integrations run in their own nonblocking job. An active
production deployment still requires its own credentials and readiness checks.

Manual production operations use `gh workflow run deploy.yml -f action=<name>`:
`release` builds local images; `deploy` redeploys an existing image; `auth`
runs the staged auth rollout; `unseal` applies bootstrap without rebuilding
Vault; `smoke` probes the active public services. Deploy/release accept an optional
`service_id`; deploy also accepts `image_tag`. Production operations require main.

Maintenance accepts `task=health|domains|snapshot|dependencies|vault-inputs`.
Health/domain reporting never applies infrastructure. Secret repair uses the
existing OpenTofu flow; `dry_run=true` plans without applying and `from_vault`
selects fields to refresh.

External callers should use `publish.yml`; the old `ci.yml` publishing
interface remains compatible. Successful publishers notify `deploy-service`
with the exact service id and image revision. Application repositories own
their code and schemas; infrastructure remains exclusively OpenTofu-owned.
