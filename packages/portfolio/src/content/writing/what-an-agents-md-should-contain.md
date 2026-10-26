---
title: 'What an AGENTS.md should actually contain'
description: "A walk through the hard rules in my monorepo's AGENTS.md files, the failure each one prevents, and the git history behind them."
draft: true
date: 2026-10-26
verify:
  - 'Word counts: root AGENTS.md 1,019, packages/fleet/AGENTS.md 6,693 (wc -w on 2026-10-26).'
  - 'The OpenTofu-only rule, prevent_destroy, -parallelism=1 and import-before-apply lines entered AGENTS.md in 160e0b19 (PR #32, merged 2026-10-01).'
  - '47 prevent_destroy occurrences across 17 .tf files under packages/infra/tofu.'
  - 'PR #62 (c6789e10) and PR #89 (4b1ab1fe) commit messages describe the adoption failures as quoted.'
  - 'The SKIP rule came from PR #54 (49263342); the application-name rule from PR #74 (d3e63749); llms.txt drift check from PR #13 (9e58994d).'
  - "'Never patch dependencies' and the size-limit rule first appear in 2a505f0d (2026-09-06); PR #69 (1ec7a9f5) removed packages/9router/scripts/oauth-redirect-patch.ts."
  - 'PR #49 (92b59d2c) static-hostname failure and PR #59 (2a36f87c) shared-key detection, as quoted.'
  - 'scripts/agent-commands.ts arrived in PR #4 (45a08029, merged 2026-09-19) and links six harness locations.'
---

Most `AGENTS.md` files I have read describe the project. That part is useful, but an agent can learn most of it by reading the code. What it cannot learn from the code is which mistakes have already happened. My monorepo, [crvouga/workspace](https://github.com/crvouga/workspace), has a root [`AGENTS.md`](https://github.com/crvouga/workspace/blob/main/AGENTS.md) of about 1,000 words and package files for [`fleet`](https://github.com/crvouga/workspace/blob/main/packages/fleet/AGENTS.md) and [`workstation`](https://github.com/crvouga/workspace/blob/main/packages/workstation/AGENTS.md). This post goes through their hard rules and, for each, the failure it exists to prevent. Where I could find the evidence in git history I cite it. Where I couldn't, I say so.

## A map, with the edges marked

The file opens with one line per package. Most of each line is location: the portfolio's content lives in `src/content/projects/`, and new projects go in `entries-part-2.ts`. The rest marks edges: "Do not commit `dist/` or the generated PDF." `packages/fleet` holds NixOS configurations "for physical machines we own" and must not "provision cloud resources there." An agent that knows where the boundary is does not have to guess which package owns a change.

## One owner for infrastructure

The hard rule: "Infrastructure resources are managed exclusively by OpenTofu," except the physical machines in `packages/fleet`. No `local-exec`, no API mutation scripts, no second IaC tool. The failure it prevents is two controllers for one resource: a script changes something live, and the next OpenTofu plan either reverts it or reports drift nobody can explain.

The rule entered the file with [PR #32](https://github.com/crvouga/workspace/pull/32), "refactor(infra): adopt OpenTofu management", merged 2026-10-01. It is enforced by [`scripts/iac-policy.test.ts`](https://github.com/crvouga/workspace/blob/main/scripts/iac-policy.test.ts), which fails on Railway, Cloudflare or PlanetScale API hosts outside `packages/infra/tofu/`. On 2026-10-20 that test failed [run 39347935864](https://github.com/crvouga/workspace/actions/runs/39347935864) on Railway API calls that [PR #100](https://github.com/crvouga/workspace/pull/100) had added to a deploy workflow. Commit [`acc261f4`](https://github.com/crvouga/workspace/commit/acc261f410800c6ab04f54b499e7eee377a83fe6) removed them.

## Adopt, never replace

"Import existing resources before applying; never replace a live database, bucket, tunnel, service, KV mount or seal to adopt it." The guard is `prevent_destroy`, which appears 47 times across 17 `.tf` files under [`packages/infra/tofu/`](https://github.com/crvouga/workspace/tree/main/packages/infra/tofu). The failure is obvious and permanent: a plan that destroys and recreates a production database to bring it under management.

Adoption did break in smaller ways. [PR #62](https://github.com/crvouga/workspace/pull/62) records that GitHub "rejects the attempted deactivation with HTTP 422" of a Pages site during adoption, "blocking the PlanetScale cutover deployment"; the fix imported the existing site instead. [PR #89](https://github.com/crvouga/workspace/pull/89) records a deploy that "failed importing github_repository_environment moviefinder:production, which does not exist yet." Both are why the rule says import first and check what exists.

The same line requires Railway operations to run with `-parallelism=1`. That one is pinned in code: [`scripts/tofu-plan.ts`](https://github.com/crvouga/workspace/blob/main/scripts/tofu-plan.ts) passes the flag and its test expects it. I did not find a commit that records the failure behind it. [[VERIFY: the Railway incident that led to serial operations, if any]]

## A missing credential is SKIP, not pass

"Missing credentials report `SKIP`, never a pass." This came in with [PR #54](https://github.com/crvouga/workspace/pull/54), which added `bun run health`. Its commit message says: "A check that lacks a credential reports SKIP, never a pass." The failure is a green report that checked nothing. Agents are prone to this one, because making the error go away looks like success.

## Keep applications out of the platform

"Never add application-name conditionals or application table DDL here." This line arrived with [PR #74](https://github.com/crvouga/workspace/pull/74), "hand app ownership to Pickflix", whose message says it would "Forget the Pickflix schema and publisher without destroying live objects." The failure is a platform repo that has to change every time an application does.

## Generated files say they are generated

"Root `llms.txt` is generated; never edit it directly." It is built from `scripts/llms-txt.template.md` and the inventory by `bun run llms:sync`. [PR #13](https://github.com/crvouga/workspace/pull/13) introduced it with a drift check; `bun run check:llms` "fails on drift." The failure is an agent fixing the output by hand and the next sync silently undoing it.

## Rules without an incident

"Never patch dependencies" and "Never disable structural size limits in ESLint; refactor instead" entered `AGENTS.md` in `2a505f0d` on 2026-09-06, a broad restructuring commit. I found no commit where either failure happened in this repo. They are preventive. The closest evidence: [PR #69](https://github.com/crvouga/workspace/pull/69) says "Replace the local CLI and patches with the upstream image" and deletes `packages/9router/scripts/oauth-redirect-patch.ts`. The size limits live in [`size-limits.cjs`](https://github.com/crvouga/workspace/blob/main/packages/eslint-rules/size-limits.cjs) at severity `error`, and no source file in `packages/` or `scripts/` disables them inline.

## Package rules: fleet and workstation

The fleet file's section "Cattle, not pets" forbids per-machine configuration: no `hardware-configuration.nix`, no disk serial, no MAC, no static `networking.hostName`. [`scripts/cattle.py`](https://github.com/crvouga/workspace/blob/main/packages/fleet/scripts/cattle.py) fails the build when those appear. The hostname rule has a recorded failure. [PR #49](https://github.com/crvouga/workspace/pull/49) says "hostnamed keeps the static /etc/hostname, which is read-only on NixOS, so fleet-identity exited and the runner units never started."

"CI and web must never share an age key or a secrets file," because, as the file says, "CI runs untrusted pull-request code." A commit in [PR #59](https://github.com/crvouga/workspace/pull/59) makes the installer "Compare recipients to detect shared role keys despite different comments," so renaming a key does not get around the rule.

The workstation file is a short list. One rule: "commands never branch on `process.platform` directly — add/extend an adapter instead." Another: "Never configure the Auto Router in the OpenRouter web UI." The failure behind the second is configuration that lives in a vendor dashboard instead of in git. [[VERIFY: a commit or incident behind the process.platform rule]]

## One command set, every harness

Rules are half of it. The other half is the commands agents run. Canonical files live in [`.agents/commands/`](https://github.com/crvouga/workspace/tree/main/.agents/commands). [`scripts/agent-commands.ts`](https://github.com/crvouga/workspace/blob/main/scripts/agent-commands.ts) links each one into six harness locations: `.claude/commands`, `.cursor/commands`, `.opencode/command`, `.windsurf/workflows`, `.github/prompts` and `.agents/skills`. It checks that each file's frontmatter has a matching `name:` and a `description:`, removes dangling links, and rejects a regular file where a link should be. `bun run agents:sync` repairs; `bun run check:agents` exits 1 on drift and runs in CI. It came in with [PR #4](https://github.com/crvouga/workspace/pull/4). The failure it prevents is copies drifting apart, so one harness follows last month's rules.

## What I'd change

- `packages/fleet/AGENTS.md` is 6,693 words, most of it procedure. I would move the procedures into docs and keep the rules.
- Put the failure next to each rule. Today the reasons live in commit messages, which agents rarely read.
- Mark which rules a test enforces and which are prose only. "Never patch dependencies" could be a check for `patchedDependencies` in every `package.json`.
