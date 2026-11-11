---
name: model-health
description: Run, read and fix the CLIProxyAPI model health report (live, nightly or offline).
---

<!-- Canonical file; harness copies are symlinks (`bun run agents:sync`). -->

# Model health

The proxy and its checks live in [dev-fleet](https://github.com/crvouga/dev-fleet): models are declared
in `cliproxy/models.json` and checked by `cliproxy/scripts/modelhealth/`; read `cliproxy/docs/model-health.md`
there. This repository runs them at the revision pinned in `fleet.revision` (`bun run cliproxy` goes
through `scripts/dev/fleet.sh`).

## Run

```sh
bun run cliproxy model-health --profile readiness   # free, no inference
bun run cliproxy model-health                       # light: 2 tiny requests per model
bun run cliproxy model-suite                        # nightly: comprehensive, bounded budget
bun run cliproxy model-suite --target mock --profile manual   # offline, no key, no spend
gh workflow run "CLI proxy health" -f profile=nightly           # in GitHub Actions
```

The client key comes from `CLIPROXY_API_KEY`, an existing `VAULT_TOKEN`, or the host. Never print it.
Prefer `readiness`, then a single `--model ID --check CAPABILITY`, before anything larger. Do not run
`nightly` repeatedly: it spends real provider usage.

## Read

Open `agent-brief.md` first (also the job summary and the `[ops] CLI proxy model health` issue).
Findings list who can fix them. `operator` findings (quota, credentials, host, proxy config) cannot be
fixed by editing code: report them and stop. `agent` findings carry a one-check reproduce
command, evidence traces and fix hints. `model-health.json` has the same data (`findings[]`, `models[]`,
schema `cliproxy/docs/model-health-report.schema.json` in dev-fleet).

## Fix

Fixes are made in dev-fleet, then this repository bumps `fleet.revision` to the merged commit.

1. Reproduce with the finding's command. 2. Decide whether the endpoint, the declaration or the
   check is wrong. 3. If a provider route lacks a capability, mark it `optional` or `unsupported` with a
   reason in `models.json`; never delete a check, loosen an assertion to pass, or report an untested
   capability as healthy. 4. Add or adjust an offline test. 5. Run
   `bun run test:cliproxy` in dev-fleet, then re-run the live reproduce command.
   A fix is verified only by a `live` run in which the finding is gone.
