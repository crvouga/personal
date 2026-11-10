# Infrastructure

OpenTofu owns every cloud and GitHub resource (`tofu/`, see [`tofu/README.md`](tofu/README.md)).
Merging to `main` applies it through **Deploy**. Agent rules: [`AGENTS.md`](AGENTS.md) and the
root [`AGENTS.md`](../../AGENTS.md). Audit of the agent-first workflow: [`AUDIT.md`](AUDIT.md).
Settings the provider cannot express: [`GAPS.md`](GAPS.md).

## GitHub merge gate (`crvouga/personal`)

Defined in `tofu/modules/inventory/inventory.tf.json` (`github.pr_ready`) and
`tofu/foundation/repository.tf`:

- `main`: PR only, no force-push or deletion, linear history, squash only (title = PR title,
  body = PR body), auto-merge, branches deleted on merge, update-branch on, zero approvals,
  no up-to-date requirement.
- Required check: `Check` (fast CI lanes).
- No merge queue: GitHub only offers it to organization-owned repositories (see `GAPS.md`).
- Actions: GitHub-owned plus an explicit allowlist, SHA pinning required, read-only token.

## Freeze

Freezing adds a required check named `frozen` that nothing reports, so no PR can merge.

```bash
# Freeze main
gh workflow run freeze.yml -R crvouga/personal -f frozen=true
# Unfreeze main
gh workflow run freeze.yml -R crvouga/personal -f frozen=false
# Confirm (lists the required checks on main)
gh api repos/crvouga/personal/rulesets --jq '.[].id' | xargs -I{} gh api repos/crvouga/personal/rulesets/{} \
  --jq '.rules[] | select(.type=="required_status_checks") | .parameters.required_status_checks[].context'
```

The workflow stores the setting in the `FREEZE` repository variable, which every foundation
plan reads as `TF_VAR_freeze`, then applies only the `main` ruleset.

## Drift

`.github/workflows/drift.yml` plans every `github_*` resource daily. A non-empty plan opens or
updates one `drift` issue; a clean plan closes it. Run it on any branch to preview that branch's
GitHub changes before merging: `gh workflow run drift.yml -R crvouga/personal --ref <branch>`.
