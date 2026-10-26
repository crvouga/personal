---
title: 'Agents draft; the pipeline is the gate'
description: 'How my monorepo constrains AI coding agents with written rules, checks that enforce them, and one agent mistake the pipeline caught a PR late.'
draft: true
date: 2026-10-26
verify:
  - '74 of 1,469 non-merge commits on main carry a Co-Authored-By: Claude trailer (62 since 2026-10-01), counted with git log on 2026-10-26.'
  - 'Whether other harnesses (Codex, Cursor, OpenCode) commit without a trailer, which would make 74 a floor.'
  - 'No inline eslint-disable for the size rules exists under packages/ or scripts/ at publish time.'
  - 'PR #100 (commit 3c0de3c9, co-authored by Claude Sonnet 5.5) merged 2026-10-20 00:24:56 UTC with the check job skipped and Required passing.'
  - "The check job's path filter at the time listed .github/workflows/ci.yml but not auth-relay-deploy.yml (git show 3c0de3c9:.github/workflows/ci.yml)."
  - "CI run 39347935864 on PR #101 started 00:29 UTC and failed 'infrastructure adapters contain no cloud control plane clients'."
  - 'Fix commit acc261f4 deleted 32 lines from auth-relay-deploy.yml; PR #101 merged 2026-10-20 02:55:42 UTC with check green.'
  - 'Whether PR #120 (6522c40f, removing the check path filter) was a response to this incident or an unrelated cleanup.'
  - 'PR #133 added packages/infra/lib/railway-deployments.ts as the single read-only Railway reader.'
---

I use AI coding agents in my monorepo, [crvouga/workspace](https://github.com/crvouga/workspace). They write code, commit messages and PR bodies. I don't trust that work because an agent wrote it, and I don't distrust it for that reason either. I trust it when the pipeline passes. This post is about how that pipeline is built, and about one time it caught an agent's mistake a PR later than it should have.

For scale: 74 of the 1,469 non-merge commits on `main` carry a `Co-Authored-By: Claude` trailer, 62 of them since October 1. [[VERIFY: whether other harnesses commit without a trailer, so this count is a floor]]

## Rules in prose, checks in code

The root [`AGENTS.md`](https://github.com/crvouga/workspace/blob/main/AGENTS.md) is the brief every harness reads. Its hard rule is that infrastructure belongs to OpenTofu: "Never add provisioning, reconciliation, API mutation, secret seeding, shell provisioners, `local-exec`, `remote-exec`, or alternative IaC controllers elsewhere." It also says "Never patch dependencies" and "Never disable structural size limits in ESLint; refactor instead."

Prose is a request. An agent can misread it, miss it, or decide its case is the exception. So each rule I care about also has a check that fails the build. The rest of this post is those checks.

## The workflow the agent runs

[`.agents/commands/pr-ready.md`](https://github.com/crvouga/workspace/blob/main/.agents/commands/pr-ready.md) is the command an agent follows to take a branch to a merged PR. All git and GitHub work goes through one engine, `bun run pr:ready <command>`, which prints one JSON object per step and uses fixed exit codes: `3` for merge conflicts, `4` for checks still pending. The agent makes only the judgement calls: the commit message, conflict resolution, the PR text, and root-cause fixes.

Its rules section is blunt: "Never disable, skip or weaken a check, never edit workflow files to make a check pass, never delete tests." It also lists when to stop and report instead of improvising: a missing secret, Vault or OIDC, Railway or Cloudflare infrastructure, a GitHub outage.

[`.agents/commands/ci.md`](https://github.com/crvouga/workspace/blob/main/.agents/commands/ci.md) adds the line I repeat most: "A green local check is not green CI." Merges to `main` call the Deploy workflow, so the agent keeps watching with `bun run gh:ci:watch` through image publication, OpenTofu and production smoke tests. It also says "never turn an unavailable check into a pass."

## Limits that force a refactor

[`packages/eslint-rules/size-limits.cjs`](https://github.com/crvouga/workspace/blob/main/packages/eslint-rules/size-limits.cjs) sets hard caps at severity `error`: 500 lines per file, 70 per function, 4 parameters, depth 4, 25 statements, cyclomatic complexity 10, one class per file. The file asserts its own constants at load time, so a typo cannot silently widen a rule. Tests are exempt from the size caps but keep the structural ones.

These limits matter more with agents than with people. An agent asked to add a feature will grow a function past any sensible size. The lint error makes it split the function instead. A search of `packages/` and `scripts/` today finds no inline `eslint-disable` for any of these rules.

## Checks on output, not just code

Some mistakes only show up in what the build produces. My résumé PDF is generated during `astro build` by [`pdf.ts`](https://github.com/crvouga/workspace/blob/main/packages/portfolio/src/resume/pdf.ts). The [portfolio README](https://github.com/crvouga/workspace/blob/main/packages/portfolio/README.md) lists four checks every candidate layout must pass: rendered height, element bounds, empty sections, and the real page count, read from the PDF bytes with `pdf-lib`. A failing candidate gets the next step in [`reductions.ts`](https://github.com/crvouga/workspace/blob/main/packages/portfolio/src/resume/reductions.ts), ordered least painful first: trim a fourth bullet, drop the last project, drop the second summary sentence. No reduction ever drops a role. When every reduction is used up, the build throws.

[`pdf.test.ts`](https://github.com/crvouga/workspace/blob/main/packages/portfolio/src/resume/pdf.test.ts) renders the real PDF through Chromium. One test asserts that current content needs at most three reductions. Its comment says why: "A rising number here means the content outgrew the page: the resume is silently dropping things." An agent that keeps padding `work.ts` trips that test instead of shipping a quietly shorter résumé.

The share card works the same way. [`render.ts`](https://github.com/crvouga/workspace/blob/main/packages/portfolio/src/social/render.ts) screenshots a 1200×630 page and throws `Share image content overflows` when any element crosses the edge. [`card.test.ts`](https://github.com/crvouga/workspace/blob/main/packages/portfolio/src/social/card.test.ts) feeds it a statement repeated forty times and expects that error.

## The policy test

[`scripts/iac-policy.test.ts`](https://github.com/crvouga/workspace/blob/main/scripts/iac-policy.test.ts) turns the OpenTofu rule into a test. `infrastructure adapters contain no cloud control plane clients` scans every `.ts`, `.sh`, `.yml`, `.yaml`, `.tf` and `.json` file outside `packages/infra/tofu/` for the Railway, Cloudflare and PlanetScale API hosts. Two read-only health adapters are allowed, and the test parses them with the TypeScript compiler instead of exempting a directory. The Cloudflare adapter may only `fetch` with a literal `GET`. The Railway adapter may only send one fixed query. The test runs in `bun run check:scripts`.

## One caught mistake, one PR late

On 2026-10-20, [PR #100](https://github.com/crvouga/workspace/pull/100) merged commit [`3c0de3c9`](https://github.com/crvouga/workspace/commit/3c0de3c9829b617e1c8c2b67da15f322387e1f92), co-authored by Claude Sonnet 5.5. It added a failure step to `.github/workflows/auth-relay-deploy.yml` that sent `curl` requests to `https://backboard.railway.app/graphql/v2` to print Railway deployment logs. The motive was sound: the commit message says the admin API wait "left no evidence of why Keycloak never answered." The method was an API client outside OpenTofu.

The policy test did not run on that PR. At the time, the `check` job in `ci.yml` was path-filtered, and its filter listed `.github/workflows/ci.yml` but no other workflow file. `check` was skipped, `Required` passed, and CI on `main` went green.

At 00:29 UTC, CI ran on [PR #101](https://github.com/crvouga/workspace/pull/101), which changed `packages/infra/tofu/foundation/auth-relay.tf`. That path matched the filter, so `check` ran against the PR merged with `main`. [Run 39347935864](https://github.com/crvouga/workspace/actions/runs/39347935864) failed on `infrastructure adapters contain no cloud control plane clients`. Commit [`acc261f4`](https://github.com/crvouga/workspace/commit/acc261f410800c6ab04f54b499e7eee377a83fe6), "ci(auth-relay): drop deploy diagnostics that call the Railway API directly", deleted the 32-line step. The PR merged with `check` green at 02:55 UTC the same day.

The test was right. The routing was wrong: a skipped check counted as a pass. Since [PR #120](https://github.com/crvouga/workspace/pull/120) on 2026-10-23, the repository checks run on every PR with no path filter. Today the final `Check` job in [`ci.yml`](https://github.com/crvouga/workspace/blob/main/.github/workflows/ci.yml) accepts `skipped` from a filtered job only when its path filter says the job was not needed, and fails when the filter output is missing. [[VERIFY: whether PR #120 was a response to this incident]]

The need behind the diagnostics was met later. [PR #133](https://github.com/crvouga/workspace/pull/133) added one read-only reader, [`railway-deployments.ts`](https://github.com/crvouga/workspace/blob/main/packages/infra/lib/railway-deployments.ts), whose query the policy test requires to start with `query Rollout(` and to contain no `mutation` or `subscription`.

## What I'd change

- The policy test matches three hostnames. A call through a vendor CLI, or to a provider not on the list, would pass it. I would rather list the allowed network clients than the forbidden hosts.
- `pr-ready.md` asks for a `## Test plan` with the exact commands run. PR #101's body says "Not run (not requested)". Nothing checks the PR body, so that rule is still prose.
- A PR should say which checks did not run. The skipped-versus-passed logic now lives in the `Check` job, but a reviewer still has to open the job log to see it.
