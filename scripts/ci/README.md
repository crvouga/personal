# CI and deployment

The root CI workflow validates every PR and merge-group entry. Its change plan selects infrastructure, authentication and portfolio URL checks; repository checks and package quality/tests always run. The `Check` job fails on failed, cancelled or unexpectedly skipped required lanes. Optional credential-dependent integrations report their own results without suppressing core validation.

Package lanes use Bun's frozen lockfile and Turborepo. Formatting, Bun downloads, task results, verified OpenTofu providers and browser downloads are cached, but the underlying checks still run. Browser planning can avoid redundant Chromium installation when task results are cached; it does not skip the tests. Each database lane installs Atlas independently.

The required check is `Check`: the fast lanes only (repository, packages, OpenTofu). PR package lanes run Turborepo `--affected`. Slow lanes (auth compatibility, cross-OS CLI, public URLs) skip PR pushes and run on `main`, merge-group and manual runs under **Slow checks**; Deploy and the CLI release wait for them. `scripts/ci-check-parity.test.ts` keeps every `bun run check` step covered by a CI lane.

Fast lanes run steps through `logged-shell.sh`; on failure `.github/actions/failure-summary` writes what failed, `file:line` and the repro command to the job summary and an artifact. `ci-report.yml` turns those into one sticky PR comment (`pr-report.ts`) and labels an agent PR `needs-human` after three failing commits. `agent-prs.yml` labels agent PRs, turns on squash auto-merge when an agent PR is opened or marked ready (and re-applies it hourly), turns it off on `needs-human`/`do-not-merge`, updates behind branches, reports conflicts, closes idle PRs and auto-merges Dependabot. `drift.yml` plans every GitHub resource daily and keeps one `drift` + `ready` issue.

`failure-issues.yml` watches CI, Deploy, Maintenance, Developer toolchain, Agent PRs and Drift on `main`. Each failing job gets one issue (`<workflow>: <job> failing on main`, labels `ci-failed` and `ready`) whose body comes from the same failure summaries as the PR report, or the failed-step log when a job has none (`failure-issues.ts`). A later failure updates it; the job's next success closes it. Roll-up jobs (`Check`, `Slow checks`) are reported only when nothing more specific failed.

Successful main pushes call Deploy. Credential preflight precedes production changes. Deploy publishes images, applies foundation/bootstrap/auth/Vault and the generic `services` root in order, then verifies the selected service revisions and public endpoints. Mutation jobs share non-cancelling production concurrency. Images are public and Railway pulls them anonymously. Unrelated deployed image revisions are preserved when only selected services change.

The reusable Publish workflow builds one service image and optionally dispatches deployment to the platform. Application repositories own their publisher workflows and validation. Maintenance runs read-only health and drift checks, dependency and snapshot update PRs, and explicitly requested secret repair. Repair and deployment remain restricted to main.

OpenTofu validation is split into validation, module and contract groups. Running `bash packages/infra/tofu/check.sh` locally covers their union. Contracts isolate provider caches, run independent tests concurrently, and publish only successful cache downloads. Provider API changes happen only through reviewed encrypted saved plans, with Railway operations serialized.

The `services` directory retains the historical shared state key described in [application decommissioning](../../packages/infra/docs/application-decommission.md). Retirement records are pending live review and apply. Local tests are not evidence that production decommissioning happened.

After a push, use `bun run gh:ci:watch` and inspect the complete CI run. A green local check cannot establish a successful production deployment.
