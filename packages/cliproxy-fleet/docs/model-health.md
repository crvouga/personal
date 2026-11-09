# Model validation and health checks

This is the declarative validation layer for the hosted OpenAI-compatible endpoint
`https://cli-proxy.chrisvouga.dev/v1`. It extends the existing external health workflow; it does
not replace the provenance, backup-freshness or recovery checks.

Everything model-specific lives in [`models.json`](../models.json). The code in
`scripts/modelhealth/` is generic: adding a model, capability, check or fault scenario is a
configuration change.

## What counts as evidence

Every result is labelled, and the report never blends the classes:

| Evidence               | Meaning                                                                                     |
| ---------------------- | ------------------------------------------------------------------------------------------- |
| `live`                 | A real request to the configured endpoint passed or failed protocol and invariant checks.   |
| `simulated`            | A scenario ran against the local emulator. It proves the harness detects the behavior.      |
| `untested`             | Nothing exercised it. It is never reported as healthy, whatever the model status says.      |
| `unsupported`          | Declared unsupported in configuration with a reason. It is not requested and not "broken".  |
| `observed_unsupported` | Declared `optional`, and the request failed cleanly (rejected, wrong shape). Informational. |

Account failover, quota exhaustion and all-accounts-unavailable behavior cannot be provoked against
the hosted proxy without burning real subscription quota. Those are `simulated` only, and their
live status stays `untested`.

**Cursor.** The Cursor suite is protocol-level compatibility: public OpenAI Chat Completions and
Responses request shapes, streaming tool calls, tool round trips, a scripted multi-step coding-agent
workflow, cancellation and recovery, usage and finish reasons. It does not reproduce Cursor's
private behavior, and no run of this suite proves the Cursor application works. Every report states
`Verified with the actual Cursor application: no`. Verifying the application needs a human running
Cursor against the endpoint with the same alias names and recording the result separately.

## Architecture

```
models.json  ──►  config.py (validate, resolve capability states)
                     │
   levels            ▼
 liveness ─► readiness ─► e2e ── per model, in parallel, isolated ──► derive status ─► JSON + Markdown
 (no key)    (key, no      │       checks.py engines  ◄── scenario.py (turn → chat | responses body)
             inference)    │       transport.py (HTTP/SSE, no redirects, no hidden retry)
                           │       protocol.py (wire contracts) + expect.py (declared invariants)
                           ▼
              emulator.py  +  simulate.py   (routing, rate limit, timeout, truncation: `simulated`)
```

- **Protocol-neutral turns.** A check describes one conversation turn (`system`, `messages`,
  `tools`, `tool_choice`, `json_schema`, `stream`, …). `scenario.py` renders it as a Chat
  Completions body and as a Responses body, so one declaration yields `chat.<id>` and
  `responses.<id>` cases.
- **Wire contract before semantics.** `protocol.py` normalizes a response and records violations
  (object type, ids, usage arithmetic, finish reasons, tool-call ids and JSON arguments, SSE
  framing, `[DONE]`, terminal Responses event, sequence numbers, streamed vs final consistency).
  `expect.py` then checks the declared invariants. Exact natural-language output is never asserted;
  text checks use random per-run tokens (`{codeword}`, `{marker}`, `{nonce}`) and tool checks use
  forced tool choice with JSON-Schema-validated arguments.
- **Independence.** Each model gets its own context, request budget share and consecutive-failure
  counter. An exception in one check becomes a `harness` failure for that check only.

## Levels and profiles

| Profile     | Levels              | Inference          | Intended use                                                                                   |
| ----------- | ------------------- | ------------------ | ---------------------------------------------------------------------------------------------- |
| `liveness`  | liveness            | none               | "Is it reachable and does it reject anonymous callers?" No credentials.                        |
| `readiness` | liveness, readiness | none               | Key works, `/v1/models` valid, **every configured alias served**.                              |
| `light`     | + cheapest e2e      | 2 requests/model   | Every 15 minutes. Chat non-stream + Responses stream.                                          |
| `nightly`   | + all `full` checks | ~53 requests/model | Comprehensive protocol, tools, agent workflow, errors, concurrency; also runs the simulations. |
| `manual`    | + `manual` checks   | + wrong-key probe  | Full diagnostics, plus the fault-injection scenarios.                                          |

Liveness checks that `GET /v1/models` without a key returns 401 (a 200 is a failure) and that the
dashboard serves. Readiness lists discovered models and reports any not in configuration
(`discovered_unconfigured`). A configured alias missing from `/v1/models` makes that model
`unhealthy` with category `alias_missing` and no inference is sent to it. It is never skipped
silently.

The wrong-key probe is `manual` only. Upstream counts failed _management_ logins toward an IP ban,
and scheduled checks must not generate failed logins; the harness never sends a management key at
all.

## Commands

```bash
# Frequent, cheap: liveness + readiness + 2 requests per model
bun run cliproxy model-health                      # default profile: light
bun run cliproxy model-health --profile readiness  # no inference
bun run cliproxy model-health --profile liveness   # no credentials

# Complete suite (default profile: nightly)
bun run cliproxy model-suite
bun run cliproxy model-suite --suite cursor        # Cursor-style agent checks only
bun run cliproxy model-suite --profile manual --model cli-proxy-open-ai-sol --output ./report

# Offline: the same declarative suite against the local emulator. No key, no spend, no network.
bun run cliproxy model-suite --target mock --profile manual
```

Useful flags: `--model ALIAS` (repeatable), `--suite core|cursor|all`, `--json`, `--output DIR`
(writes `model-health.json` and `model-health.md`), `--state FILE` (last-success memory),
`--max-requests N`, `--concurrency N`, `--timeout-scale F`, `--seed N` (reproducible tokens),
`--fail-on unhealthy|degraded`, `--allow-unknown`.

Exit codes: `0` ok, `1` unhealthy (or degraded with `--fail-on degraded`), `2` unknown (for example
no credentials; a result that was not obtained is never a pass), `3` bad configuration or arguments.

The client key is read, in order, from `CLIPROXY_API_KEY`, an existing `VAULT_TOKEN`
(`secret/personal/prd:CLIPROXY_FLEET_CLIENT_API_KEY`, the same short-lived GitHub OIDC login the
workflow already uses), then the installed host's `state/secrets/client-key`. It is held in memory,
sent only as a bearer header, registered with the redactor, and never printed or written.

## Status model

Per model: `healthy`, `degraded`, `unhealthy`, `unknown`.

- `unknown`: inference was not exercised at this scope, readiness did not pass, or no check
  completed. Readiness-only profiles therefore report models as `unknown`, not `healthy`.
- `unhealthy`: alias not served; a `critical` required capability fails; or at least
  `health.unhealthy_if_failed_ratio` of the exercised required capabilities fail.
- `degraded`: a non-critical required capability fails, a required capability's optional sibling
  hit an infrastructure failure, latency exceeds `health.latency_ms`, or one alias resolved to
  several model ids (`health.alias_consistency`).
- `healthy`: everything that was exercised passed. **Healthy applies to the exercised capabilities
  only**; read `coverage` and the `untested` rows. A `light` run exercises 2 of 38.

Run-level status is the worst of the levels and models. Simulation failures degrade it.

Safeguards against runaway cost: an exhausted budget leaves the remaining checks `untested` with
reason `budget`; four consecutive failures, or any HTTP 429, stop further requests to that model
(`aborted`); inference requests are never retried (`retry.inference` must be 0 and the validator
rejects anything else). Only the read-only model listing is retried once, on transport errors.

## Configuration reference (`models.json`)

| Section                                 | Purpose                                                                                 |
| --------------------------------------- | --------------------------------------------------------------------------------------- |
| `endpoint`                              | Base URL (HTTPS), key environment variable, Vault field.                                |
| `runs`                                  | Profiles: levels, highest check tier, request/token budget, concurrency, `simulations`. |
| `timeouts`, `retry`                     | Per-request, stream idle/deadline, liveness; retry policy.                              |
| `health`                                | Abort threshold, unhealthy ratio, latency warnings, alias consistency.                  |
| `protocols`                             | Path and token-limit field for `chat` and `responses`.                                  |
| `capability_profiles`                   | Default state, `optional` and `unsupported` capability globs, shared request extras.    |
| `models`                                | Alias, provider, profile, per-model capability overrides and request extras.            |
| `tools`                                 | Function definitions (JSON Schema) shared by checks.                                    |
| `checks`                                | Declarative test cases (below).                                                         |
| `simulated_capabilities`, `simulations` | Routing, rate-limit, timeout and truncation scenarios.                                  |
| `cursor`                                | Compatibility statement shown in every report.                                          |
| `diagnostics`                           | Actionable advice per failure category.                                                 |

Capability ids are `<protocol>.<check id>`, for example `responses.tools_stream`. States are
`required`, `optional` (failure by assertion, protocol or rejection becomes
`observed_unsupported`; infrastructure failures still count) and `unsupported` (needs a reason).
Globs such as `*.tools*` are matched with `fnmatch` and must match at least one capability, so a
typo is a configuration error.

Check kinds (the only code paths): `request`, `roundtrip` (tool call, result, answer), `agent`
(scripted read, edit, test workflow with a virtual file system), `cancel_recover`, `concurrent`,
`error_probe`. Expectations: `finish_reason`, `content` (`non_empty`, `contains`), `usage`,
`stream` (`min_events`, `max_gap_s`), `json` (schema), `tool_calls` (`min`, `max`, `names`,
`unique_ids`, `arguments_schema: from_tools`, `arguments`, `values`), and for probes `status` and
`error_envelope`. Tiers: `light` < `full` < `manual`. Severities: `critical`, `major`, `minor`.

### Add a model

Append to `models` and nothing else:

```json
{
  "alias": "cli-proxy-new-model",
  "provider": "anthropic",
  "profile": "frontier-agent",
  "capabilities": {
    "*.json_schema": {
      "state": "unsupported",
      "reason": "No structured output on this route."
    },
    "responses.parallel_tools": "optional"
  },
  "extra": { "chat": { "reasoning_effort": "low" } }
}
```

Run `python3 -B packages/cliproxy-fleet/scripts/check.py` (it validates `models.json`), then
`bun run cliproxy model-suite --target mock` and finally a live `--model` run. Unit tests
(`tests/test_model_config.py`) demonstrate that a new model is picked up with no code changes.

### Add a capability or check

Append to `checks`. Reuse a kind, write the turn and the expectation, choose `severity`, `tier` and
`suites`. List the protocols it applies to; the capability ids appear automatically in every
model's report, defaulting to the profile's state. If no existing kind can express it, add a kind
to `checks.RUNNERS`; that is the only case that needs code.

### Add a fault scenario

Append to `simulations` (accounts with `quota` or `fail_next`, then `request`, `fault`,
`account`, `advance` steps with `expect` keys such as `served_by_all`, `served_set`, `category`,
`retry_after`, `no_retry`). The emulator's virtual clock (`advance`) makes cooldown recovery
instantaneous and deterministic.

## Multi-account routing: fill first

The proxy is configured to multiplex across accounts with a **fill-first** pattern: one account
takes all traffic until its quota is exhausted (a 429 puts it into cooldown), then the next
account serves, and so on. This is `routing.strategy: fill-first` in
[`config.template.yaml`](../config.template.yaml), together with `session-affinity: true` (a
session stays on its account while that account is available and rebinds on failover),
`cooldown.disable-cooling: false` (cooldown is what moves the fill to the next account) and
`retry.max-retry-credentials: 0` (every eligible account may be tried, so several exhausted
accounts still reach the next usable one). `models.json` mirrors the policy under `routing`, and a
test fails if the two disagree.

What is enforced where:

- **New or recovered deployments** start from the template, so they fill first.
- **`cliproxy apply FILE`** passes `--require-fill-first` to `validate-config`; a candidate config with
  another strategy is refused. Starting an existing config is not blocked, so an older deployment
  still comes up after an install.
- **The five-minute host monitor** reports `Live routing strategy is not fill-first` when the
  running `state/runtime/config.yaml` differs from the policy. This is the signal that the live
  config still needs the change below.
- **The emulator** implements the same policy (ordered fill, quota and transient-error cooldowns of
  30s and 60s, affinity binding that outranks order, rebinding on failover) and the scenarios
  `fill_first_*`, `transient_failure_cools_the_account_then_it_rejoins` and
  `session_binding_survives_recovery_and_rebinds_on_failover` assert it. The same scenarios fail
  when the emulator is switched to round robin, so they cannot pass vacuously.

**Applying it to the running proxy is an operator step.** The repository cannot change the live
config, and the strategy is not observable through the API, so the health report labels the policy
`declared` and never `live_verified`. On the proxy host:

```bash
cp /opt/cliproxy-fleet/state/runtime/config.yaml /protected/candidate.yaml
# edit routing: strategy -> fill-first, retry.max-retry-credentials -> 0; change nothing else
bun run cliproxy apply /protected/candidate.yaml   # validate, isolated staging, restart, health wait
bun run cliproxy status                           # monitor-failed clears on the next 5-minute run
```

Not established by this repository: which account counts as "first". Upstream chooses the order
among OAuth credentials; the vendored configuration documents `priority` (larger first) only for
API-key entries. Confirm the fill order on the host (for example by watching which account's quota
moves in the dashboard) before relying on a particular account being drained first.

## Running in T3 Code and other agent sandboxes

The offline suite is hermetic: it uses only loopback sockets on ephemeral ports, standard-library
Python (3.9 through 3.15, so both the system and the mise-pinned interpreter work), temporary
directories it removes, and no network, credentials, Docker, Restic or PyYAML. Tests scrub ambient
`CLIPROXY_API_KEY`, `VAULT_TOKEN`, `CLIPROXY_ROOT` and proxy variables, and a test proves a
planted key is never used or printed. The suite passes under `python -X dev -W error` (no leaked
sockets), with a hostile environment, and 8-way parallel with CPU hogs running.

```bash
# T3 project action (runs the shared bootstrap first, then the personal CLI)
bash scripts/dev/project-action.sh infra-cliproxy model-suite --target mock --profile manual
bash scripts/dev/project-action.sh infra-cliproxy model-health          # live, needs a key

# Unit tests only, through the pinned toolchain
mise exec -- bun run --filter @pkgs/cliproxy-fleet test:models
mise exec -- bun run --filter @pkgs/cliproxy-fleet lint
```

Suggested T3 script labels: `Infra: Cliproxy model health` (`infra-cliproxy model-health`) and
`Infra: Cliproxy model suite` (`infra-cliproxy model-suite`). The full package `test` still needs
Restic and PyYAML for the older backup and recovery tests; `test:models` does not.

## Emulator and contract tests

`scripts/modelhealth/emulator.py` is a deterministic implementation of the public wire protocols
plus the proxy's documented routing policy from `config.template.yaml`: round robin, session
affinity, cooldown after quota exhaustion, bounded credential retries. It supports injected faults
(status codes, stalls, truncation, malformed SSE, missing ids or usage, cross-request token
contamination). It is a test double, not a model of any provider's behavior.

Pull requests run these as part of `bun run --filter @pkgs/cliproxy-fleet test` (offline, a few
seconds, no spend): protocol validators against valid fixtures and one mutation per defect, SSE
framing edge cases against a raw socket server, property-style tests (randomized tool-argument
fragmentation, schema validation), fill-first routing, the full suite against the emulator, per-model isolation,
budgets, fault detection, last-success persistence, and secret hygiene.

## Scheduling

[`cliproxy-health.yml`](../../../.github/workflows/cliproxy-health.yml):

- Every 15 minutes (minutes 7, 22, 37, 52): the existing endpoint and cloud-checkpoint freshness
  check, then `model-health` (`light`). Failure level: `unhealthy`.
- 03:41 UTC nightly: `model-suite` (`nightly`), failing on `degraded`.
- Manual dispatch: choose profile, suite, a single model and a lower request budget.

Each run uploads `model-health.json` as an artifact (30 days), appends the Markdown report to the
job summary and persists last-success times through the Actions cache. Budgets come from
`models.json` and can only be lowered at dispatch.

## Report

`model-health.json` (`schema: cliproxy-model-health/1`) contains `levels`, `models[]` (status,
reasons, `coverage`, `capabilities` with declared state and observed result, `checks[]` with
category, endpoint, severity, details and observations, `metrics`, `last_success`),
`simulations`, `budget`, `cursor` and `summary.diagnostics`. Metrics per model: availability, check
success rate, TTFT p50/max, latency p50/p95, streaming completion rate, tool-call success rate,
error categories, upstream failures and the resolved model ids. Routing outcomes are reported only
for simulations.

Failure categories: `credentials`, `auth`, `not_found`, `rate_limit`, `timeout`, `transport`,
`upstream`, `protocol`, `assertion`, `request_rejected`, `budget`, `aborted`, `alias_missing`,
`harness`. Diagnostics never contain keys, tokens, request bodies or prompt text; messages from the
endpoint are redacted and truncated to a few hundred characters.

## Investigating a failure

1. Open the run summary. Read **Levels** first: a liveness or readiness failure explains every
   model failure below it.
2. `transport`/`timeout` at liveness: host, tunnel or DNS. Use `bun run cliproxy status` on the
   workstation. `auth` at readiness: the client key and `access.api-keys` disagree.
3. `alias_missing`: the alias is not in `/v1/models`. Compare `bun run cliproxy models` with
   `models.json`; alias mappings are live configuration (dashboard), not part of the template.
4. A model `unhealthy` with `upstream`/`rate_limit`: provider account or quota. Check the
   dashboard and `bun run cliproxy logs`. The harness already stopped requesting after the first 429.
5. `protocol` or `assertion`: reproduce one case with
   `model-suite --profile nightly --model ALIAS --seed N` (the seed is in the report). `protocol`
   after a CLIProxyAPI upgrade usually means the translation changed; compare the check's details
   with the validator in `protocol.py`.
6. If the capability is genuinely unavailable on that route, change its state to `optional` or
   `unsupported` with a reason, in a reviewed commit. Do not delete checks to make a report green.
7. `harness`: a defect in the checks, not the endpoint. Run the unit tests.

## What was and was not verified

The emulator and unit tests prove the harness's assertions, classification, budgets and reports.
They do not prove the hosted endpoint is healthy. Live health is established only by a report whose
target is `live` with `evidence: live` checks; until a scheduled or manual run has completed with a
valid client key, no model has a live validation on record. The first live run may legitimately
surface capability declarations in `models.json` that need adjusting (for example parallel tool
calls or structured output on a given route); such results are the signal the configuration
exists to capture.
