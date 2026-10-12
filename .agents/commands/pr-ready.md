---
name: pr-ready
description: Take the current branch from uncommitted work to a merged PR with every check green — commit, push, merge main, resolve conflicts, open the PR, fix CI until green, then auto-merge.
---

<!--
  Canonical file. The copies under .claude/commands, .cursor/commands,
  .opencode/command, .windsurf/workflows, .github/prompts and .agents/skills
  are symlinks created by `bun run agents:sync`. Edit this file, never a link.
-->

# /pr-ready

Take the current branch from "changes exist" to "PR is green and merged into
`main`". All git and GitHub work goes through the engine:

```sh
bun run pr:ready <command> [flags]
```

Every command except `logs` prints **one JSON object**. Read that JSON; never
parse raw `git` / `gh` output. Exit codes: `0` ok · `1` fail · `2` usage ·
`3` merge conflicts · `4` checks pending or timed out. Failures look like
`{ "ok": false, "step": "…", "output": "…", "hint": "…" }` — follow the hint.

You make only the judgement calls: the commit message, conflict resolution,
the PR title and body, and root-cause fixes for CI failures.

**Stop and report** (don't improvise around it) if `status` fails, if you get an
exit-2 error you can't fix from its hint, or if a CI failure can't be fixed in
the repo (missing secret, Vault/OIDC, Railway/Cloudflare infrastructure, a
GitHub outage).

## Repo facts

- Bun + Turborepo monorepo. Trunk is `main`. The pull request workflow is
  `.github/workflows/ci.yml` (`infra-health.yml` is a scheduled read-only
  report that never runs on PRs). On pull requests it runs `changes`, `check`,
  `portfolio-health-check` (portfolio changes only), `commitlint`, `pr-title`,
  and the aggregator **`Required`** — the only required status check.
- Full local gate: `bun run check`. With Vault (portfolio build needs
  `PORTFOLIO_GITHUB_TOKEN`): `bun run check:ci`. Focused package checks:
  `bun run --filter @pkgs/<name> tc|lint|test|build`.
- Never stage secrets: `.env`, `.vault-token`, `VAULT_TOKEN`, `RAILWAY_TOKEN`,
  deploy tokens. `commit` stages everything (`git add --all`) unless you pass
  `--path`, so check `status.worktree.files` first.
- Merges to `main` publish and deploy. Never run Railway, Cloudflare, DNS, or
  `tofu apply` from a feature branch.

## Steps

### 1. Preflight

Run `bun run pr:ready status` and require `ok: true`. Require `gh auth status`
to succeed. If the branch is `main`, create a feature branch first.

### 2. Merge gate

Run `bun run pr:ready repo` and `bun run pr:ready ruleset`. If either reports
`ok: false`, review the OpenTofu foundation plan and fix the declared repository policy there. These commands only inspect configuration.

### 3. Commit and publish

Run `bun run pr:ready context`. From its output, write **one** Conventional
Commit message:

- type is one of `feat` `fix` `chore` `docs` `test` `refactor` `ci` `build` `perf` `style`
- header ≤ 120 characters; scope only if it matches a real package or area (no
  invented scopes)
- a body only when the why isn't obvious

Write it to a temp file outside the repo and run
`bun run pr:ready commit --message-file <file>`. If commitlint rejects it
(`step: "commitlint"`), rewrite the message and retry — at most three times,
then stop and report. If only the message of an **already-pushed** tip commit
is wrong, use `commit --amend --message-file <file>` then
`publish --force-with-lease`, and mention that in the PR body.

Run the full local check (`bun run check`, or `bun run check:ci` when Vault is
available). Fix root causes and commit the fixes the same way. Then run
`bun run pr:ready publish`.

### 4. Sync with `main`

Run `bun run pr:ready sync`.

- `alreadyUpToDate: true` → continue.
- `merged: true` → run `publish` again.
- exit `3` → for each path in `conflicts`, open the file and resolve it keeping
  **both sides' intent** (never take one side wholesale), then `git add` it.
  Run `sync --continue`, then `publish`.
- exit `2` (dirty worktree) → go back to step 3.

Repeat until `sync` reports up to date.

### 5. Open the PR

Run `bun run pr:ready pr`. If it returns `created: false`, the PR already
exists. Otherwise write:

- a Conventional title (same rules as the commit header)
- a body with `## Summary` (2–4 bullets drawn from `context`) and
  `## Test plan` (the exact commands you ran)

Write the body to a temp file outside the repo and run
`bun run pr:ready pr --title "<title>" --body-file <file>`. If the PR is a
draft and the work is ready, run `bun run pr:ready pr --ready`.

### 6. Loop CI to green

Run `bun run pr:ready checks`.

- exit `4` → run it again.
- exit `1` → for each entry in `failing`, run
  `bun run pr:ready logs --name "<check>"`, find the root cause, reproduce it
  locally with the closest script (`bun run ci:format`, `bun run --filter
<pkg> lint|tc|test|build`, `bun run check`), fix it, commit and publish (step
  3), then run `checks` again. If the same check fails twice, read the full log
  (`--tail 1000`) and reproduce it locally before pushing again.
- `Required` fails whenever any job it needs failed — fix that job, not
  `Required`.

### 7. Land

Run `bun run pr:ready merge --auto`. GitHub merges with a merge commit once
`Required` is green.

### 8. Report

Run `bun run pr:ready status` and report: branch, upstream, PR number and URL,
base, merge state, each check with its bucket, and the required contexts. Only
report success when `checks` exited `0` with zero failures.

## Rules

- Never `git push --force`; only `--force-with-lease`, and only after amending the message of an already-pushed tip commit (step 3).
- Never push the base branch. Never target a base other than `main`.
- Never `git reset --hard` or `git checkout .`.
- Never disable, skip or weaken a check, never edit workflow files to make a check pass, never delete tests.
- Keep each fix minimal and aimed at the failing check's root cause.
- Don't paste full diffs or full CI logs into chat; quote only the failing lines.
- Only merge commits land on `main`.
