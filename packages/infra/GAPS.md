# Gaps

Things the agent-first workflow wants that OpenTofu (`integrations/github` 6.13.0) or the
platforms cannot express. Each entry says what is missing and the exact command, if any.

## Merge queue

GitHub offers merge queues only on organization-owned repositories; `crvouga/personal` is owned
by a user. `repository.tf` keeps a `merge_queue` block that stays empty. Slow checks therefore
run after merge on `main` (and in any future queue), not before. To get a queue, transfer the
repository to an organization (this changes GHCR paths, Vault OIDC subjects, npm provenance and
every caller of the reusable workflows):

```bash
gh api -X POST repos/crvouga/personal/transfer -f new_owner=<organization>
```

Then add to the `main` ruleset in the inventory:
`{"type": "merge_queue", "parameters": {"merge_method": "SQUASH", "max_entries_to_build": 5,
"min_entries_to_merge": 1, "max_entries_to_merge": 5, "min_entries_to_merge_wait_minutes": 1,
"grouping_strategy": "ALLGREEN", "check_response_timeout_minutes": 30}}`.

## Separate agent identity and human-only bypass

Agents push and open PRs as `crvouga` through the local `gh` login, so GitHub cannot tell them
from the human. A ruleset bypass for the admin role would also let agents bypass, so the ruleset
has no bypass actors. Creating a machine user (or GitHub App) cannot be done through any API.

1. Create the machine account by hand and give agents its fine-grained token (Vault, T3 thread env).
2. Add it as a `push` collaborator in `github_repository_collaborators.workspace`.
3. Add to `github_repository_ruleset.main`:
   `bypass_actors { actor_type = "RepositoryRole", actor_id = 5, bypass_mode = "pull_request" }`.
4. Identify agent PRs by author instead of branch in `scripts/ci/agent-prs.ts`.

## Ruleset attribute the provider does not model

The live `main` ruleset has `require_extra_approval_for_unattributed_changes: true` (set by
GitHub). It has no effect with zero required approvals. To clear it:

```bash
gh api repos/crvouga/personal/rulesets/23686210 > /tmp/ruleset.json
jq '(.rules[] | select(.type=="pull_request") | .parameters.require_extra_approval_for_unattributed_changes) = false
    | {name, target, enforcement, conditions, rules, bypass_actors}' /tmp/ruleset.json \
  | gh api -X PUT repos/crvouga/personal/rulesets/23686210 --input -
```

## Secret scanning extras

The provider omits non-provider patterns and validity checks (see `repository.tf`). Push
protection and secret scanning are managed; gitleaks also runs in CI. Optional:

```bash
gh api -X PATCH repos/crvouga/personal \
  -f 'security_and_analysis[secret_scanning_non_provider_patterns][status]=enabled' \
  -f 'security_and_analysis[secret_scanning_validity_checks][status]=enabled'
```

## `FREEZE` repository variable

Deliberately not managed by OpenTofu: unfreezing must work while no PR can merge.
`.github/workflows/freeze.yml` sets it (`gh variable set FREEZE --body true|false`) and applies
the ruleset. See [`README.md`](README.md#freeze).

## Deploy credentials without OIDC

Vault is read through GitHub OIDC. These providers have no GitHub OIDC federation, so Deploy
uses stored secrets: Railway (`RAILWAY_TOKEN`), Cloudflare (`CF_API_TOKEN`), Neon
(`NEON_API_KEY`), PlanetScale (`PLANETSCALE_SERVICE_TOKEN*`), R2 state (`TOFU_STATE_*`).
`DEPLOY_DISPATCH_TOKEN` (a PAT) drives the GitHub provider, GHCR pushes, branch updates and
Dependabot auto-merge, because pushes and merges made with `GITHUB_TOKEN` start no workflows.
A GitHub App installation token would replace it once an agent identity exists.

## T3 Code project configuration

T3 Code settings live in T3, not GitHub. The project uses a worktree per thread and runs
`bun run check` from its `Repo: Check` script. T3 has no per-project default prompt; agents get
the rules from `AGENTS.md` (`CLAUDE.md` and `GEMINI.md` point to it). Production Vault secrets
stay in CI and Deploy; thread environments must not load `secret/personal/prd`.

## Resuming the agent after a CI failure

GitHub-hosted runners cannot reach T3 Code. The hourly T3 scheduled task "Resume agent PRs with
failing CI" (project `personal`, stored in T3, not this repo) reads failing agent PRs' "CI
report" comments and sends the failure to the thread linked to the PR, once per commit; after
three failing commits `ci-report.yml` labels the PR `needs-human`.
