# CI latency

The PR pipeline optimizes elapsed time by running independent checks on separate
GitHub-hosted runners. This consumes more concurrent runners than the old serial
pipeline. Account concurrency limits can still introduce queue time.

A successful [baseline PR run](https://github.com/crvouga/workspace/actions/runs/40118639815)
took approximately 24½ minutes: Check took 736 seconds, then Nix took another
725 seconds. Installer builds also started only after Check completed. Another
[baseline](https://github.com/crvouga/workspace/actions/runs/40117121865) spent
roughly three minutes enabling Windows Media Foundation during Playwright setup.

The first complete [overhauled PR run](https://github.com/crvouga/workspace/actions/runs/40133151595)
passed in **4 minutes 18 seconds**, measured from workflow creation to completion:
approximately **82% less elapsed time** than the 24½-minute baseline. Check
completed after 3 minutes 5 seconds; Nix image construction was the final build
lane. All selected integration checks, four Nix groups and five native installer
platforms passed. This run had warm package/image caches and actual Nix builds;
it is not a cold-cache guarantee. Hosted queues and changed inputs affect timing.
A subsequent [warm run](https://github.com/crvouga/workspace/actions/runs/40134330309)
passed in **4 minutes**, approximately **84% less elapsed time** than baseline.

## Scheduling and gates

`changes` computes integration filters and checks release completeness. Packages
and optional credential probes start immediately. Repository checks, OpenTofu,
Fleet integration, auth, URL probes, Nix and installer jobs depend only on the
short change plan. They never wait for the aggregate Check job.

- Packages have separate quality and test/build runners.
- OpenTofu has validate, module-test and contract-test runners. Running
  `bun run check:infra` locally still runs every group. Each runner initializes
  providers serially within its own cache directory. Contract tests overlap on
  three workers, each with its own writable provider cache; verified downloads
  merge back only after every contract succeeds.
- Fleet integration runs the process and production-image contracts separately.
- Auth image contracts and compatibility fixtures have independent runners.
- Nix runs roles, runtime, lifecycle and image concurrently. Its partitioner
  assigns newly added flake checks to roles automatically. VM groups retain
  two builds/two cores; static role/image groups use four builds/four cores. Only image uploads
  the ISO; every group must pass before release.
- When installer inputs are affected, all five platforms retain unit, browser,
  packaged-binary and applicable native Nix acceptance tests. Within each native
  job, unit tests, source-page browser contracts and packaging/self-test run
  concurrently, including the independent native Nix build on Linux. Packaged
  and Nix browser acceptance both remain mandatory. Disposable local Gherkin scenarios run on four workers with
  private temporary files; live scenarios stay serial. Each check and Python batch has a private temporary directory,
  preventing races between simulated installer request files. Python tests run in isolated batches
  with at most eight workers. Real unittest discovery includes dynamic tests;
  module and class fixtures stay together. Batches interleave files to avoid
  leaving a long suite at the end. HTTP fixtures poll every 10 ms, and the quit
  contract joins the stopped server instead of waiting for a 20-second client
  timeout. Every platform installs the headless Chromium shell and validates a real
  browser launch and render. Linux installs OS libraries only if that probe
  identifies missing libraries, avoiding unconditional package-manager updates.
  Headless downloads are cached by OS, architecture and required version set;
  different version sets cannot win an incomplete immutable cache key.

The three status-only gates use lightweight container runners with Bash and jq.
Builds and tests retain full runners, including KVM for NixOS VMs.
Check aggregates all core lanes. A conditional lane may skip only when its filter
is explicitly false. Failure, cancellation, missing filters and unexpected skips
fail the gate. Fleet also requires successful Nix/installer matrices and any
required release. Required continues to cover Check and Fleet for the existing
ruleset. Publishing still waits for successful validation. Optional credentials
never enter task caches and their probes do not delay required statuses.

The installer release uses `!cancelled()` and explicitly requires successful
Check, Nix and installer jobs. This avoids GitHub's implicit `success()` guard
skipping the release when an unaffected integration upstream of Check skipped.
Fleet still fails if a required release does not succeed.

Fleet PR selection uses the actual tested merge tree, with rename detection
disabled so both deleted and added paths contribute. Documentation-only Fleet
PRs skip binary builds and Fleet integration. Changes confined to known role,
host, hardware and settings Nix files retain Nix checks and skip unchanged
installer packagers. Unknown paths, unavailable diffs and packaging inputs run
both build lanes. Merge-queue, main release and manual runs retain the full Fleet
build set whenever Fleet is selected. The Fleet gate rejects unselected failures,
missing scope outputs and any attempt to skip release-required builds.

Manual CI runs exercise every conditional lane. PR and merge-queue workflows
always run and report statuses, including for documentation-only changes.

## Reuse

Formatting reuses Prettier's content-validated cache across checkouts. The GitHub
cache key includes the frozen dependency lock and formatter configuration; the
Prettier CLI still runs and verifies changed content, resolved options and its
own tool version. Regression tests confirm edits and configuration changes cannot
reuse a stale formatting pass. Cache-key globs cover root and flat-workspace
configuration without recursively walking installed dependencies. The previous
recursive key scan cost 16 seconds before restore and 17 seconds before save in
the measured run; the bounded scan took 0.11 seconds locally.

Bun download caches are partitioned by OS, architecture, tool version and lockfile.
Every install still uses the frozen lockfile. Installer Python build dependencies
use setup-python's pip cache.

Each package lane restores `.turbo` from earlier runs, then always invokes Turbo.
Turbo decides reuse from task inputs and dependency hashes. Successful task
entries are saved even when a different task fails, so retries retain valid work. Shared ESLint rules
invalidate every lint task without discarding unrelated compiler, test or build
results. Strict TypeScript settings remain shared inputs; Fleet and infrastructure
checks also track the repository files they inspect outside their package.
Inventory and publisher-template inputs are scoped to their actual consumers:
infrastructure, Fleet, auth relay, password manager, portfolio and the cache
server. New filesystem consumers must declare these inputs in their package
Turbo configuration. Real Turbo planner tests verify that both inventory and
template edits invalidate every current reader, while unrelated package results
remain reusable. The same tests ensure shared lint-rule edits reach every linter.
The hosted runner's `ImageOS` generation participates in task fingerprints, so
an operating-system/toolchain migration cannot reuse tests from the old image.
Generated browser bundles and portfolio builds declare their `dist` outputs so
cache hits restore usable artifacts. Fleet API tests explicitly depend on their
asset build, avoiding cold-checkout races. External integration probes always run when
affected; they are not cached task successes. Before package tests, a Turbo dry
run determines whether any uncached browser-dependent test or build needs
Chromium. Matching installed Playwright versions share one browser/dependency
installation; every distinct version is still installed. Unreadable manifests or plans conservatively install it. The actual
Turbo test/build command always runs.

OpenTofu caches only downloaded provider binaries. Cache keys include each
validation/deployment lane, avoiding an immutable partial cache from another
job winning the same key. Provider locks still verify
installed packages. State, plans, backend metadata, tfvars and credentials are
never cached. Docker production-image tests use separate BuildKit cache scopes
and load the resulting images locally without publishing them.

## Nix evaluation and test results

Each group evaluates its selected check derivations once, then builds those exact
`.drv` paths. This preserves Git revision identity and avoids evaluating the same
NixOS graph again just to build it.

Runtime and lifecycle VM checks save small success records keyed by exact Nix
derivation paths. Records include the validating commit, Nix version and scheduler
code hash. A fallback cache can reuse unchanged checks while rebuilding changed
ones. Records are written only after a successful build; failed VM groups retain
only outputs that Nix independently reports as valid. The group still fails, and
unchanged successes can be reused on the repair run. Cache keys include commit
and attempt so immutable partial caches can advance to complete results.
Malformed or incompatible
records cause a rebuild. Logs identify every reused check and its original commit.
These records can avoid building or fetching VM closures for unchanged tests.

A shared Nix store cache also retains pinned dependencies. Roles and image
restore it; only roles saves it, avoiding large duplicate archives. VM groups
retain the lightweight success records: restoring the large store added
40–54 seconds to their already reusable tests in the warm benchmark.
The immutable key includes the runner platform, pinned Nix installer and
`flake.lock`, rather than creating a new store archive for every commit. Garbage
collection targets 4 GiB before saving (live output roots remain protected).
Only `/nix` is cached. Nix still evaluates the current Git revision and builds
its exact derivations, including changed role and image outputs; a cache miss
falls back to normal downloads and builds. No external service or credentials
are needed.

The Fleet cache publisher also restores these dependencies after a public
exact-revision probe reports a miss. That probe evaluates all five exact role
paths and pinned public metadata in one Nix call, then still verifies every
public signature. It submits all five role closures in one
Nix build with four jobs/four cores, then preserves the role-specific publication
links. Exact revision proofs, signature verification and content-before-metadata
publication remain mandatory. A real Nix fixture verifies all five output links.

A shared-package Nix evaluation experiment was rejected: after warming inputs,
the unmodified flake took 108.4 seconds versus 115.7 seconds for the trial.
Its initial 158.5-second cold measurement was not a comparable baseline. The
flake was left unchanged by this optimization pass.

Role closures and installer images always materialize their actual outputs, even
with warm caches. Full flake validation remains mandatory. Manual workflow runs
pass `--fresh`, exercising VM tests without historical success records. The normal
GitHub cache branch boundaries apply; no additional service or credentials are
required.

## Verification

`bun run check:scripts` exercises workflow gate failures, conditional skips,
release recovery, scheduling and the equivalence of distributed OpenTofu groups
to the full local suite. Fleet tests exercise concurrent Python discovery,
process isolation, file failures and empty selections. Run actionlint against
`.github/workflows/ci.yml` after changing expressions or matrices.

After pushing, compare the complete CI run with the baselines above using
`bun run gh:ci:watch`. Measure both a cold run and a follow-up commit that can
restore caches. Local checks do not prove hosted runner or cross-platform timing.

## Publishing and rollout

After OpenTofu applies service changes, CI reads Railway deployment status for
explicit image selections and services whose image or variables changed. Untouched
services remain covered by the public health checks. Image/variable changes require
a deployment created after that apply started, even when the image tag is unchanged.
The selected image must be successful and active, or successfully deployed and
sleeping until the mandatory public probes wake it. Failed deployments and
verification errors fail CI; an older healthy instance cannot pass the rollout gate.
This adapter only queries deployment metadata and never deploys.

Automatic deployments rebuild only affected local service images; shared runtime
or toolchain inputs rebuild all dependent images. Independent local image builds
run two at a time, and any failure blocks deployment after in-flight work ends.
Production and reusable publishers restore intermediate BuildKit layers from a
`buildcache` tag in each existing image package. Cache export failure cannot hide
an image publication failure. Base images are checked on every publication;
scheduled data refreshes force the final build stage to run again while reusing
frozen dependencies and browser/system packages.

Fleet API builds install filtered workspace dependencies and retain only production
dependencies in the runtime image. Cache-server and portfolio installs are also
filtered. Portfolio uses the headless Chromium shell for PDF generation.
Auth production images build concurrently in one cached Bake graph, including
the exact local-cache identity image exercised by startup/restart checks.
Auth compatibility uses one cached Bake dependency graph for identity, broker and
mock images, then still runs the complete real compatibility suite.

OpenTofu setup reuses the exact pinned binary within a job, and Atlas setup runs
once per job. Deploy and maintenance cache only lock-verified provider downloads;
every root still initializes its own backend, plans and applies the saved plan.
Railway applies remain serial. Independent auth admin HTTP readiness checks run
concurrently. Identity, connector, foundation or unknown changes retain the full
four-minute continuous stability window. Only proven gateway-only/no-op hosting
plans with an unchanged foundation may use an immediate successful live probe.
Missing plan metadata always restores the full window.

The current main branch's password-manager browser contracts remain mandatory as
a cached prerequisite of its package test task. Browser planning sees that task,
and the shared installer deduplicates equal Playwright versions across all four
browser consumers. Each database lane installs its own Atlas/OpenTofu tools.
Windows fixture cleanup terminates the entire PyInstaller child process tree and
waits for stream closure before removing temporary DLLs.

Parallel USB scenarios use distinct simulated device paths and serials, including
Windows' global named-device mutex namespace. Tests still exercise the actual
device-lock safety check. A terminal installer error fails the browser scenario
promptly instead of spending the whole success timeout waiting for another screen.
