# CI latency

The PR pipeline optimizes elapsed time by running independent checks on separate
GitHub-hosted runners. This consumes more concurrent runners than the old serial
pipeline. Account concurrency limits can still introduce queue time.

A successful [baseline PR run](https://github.com/crvouga/workspace/actions/runs/40118639815)
took approximately 24½ minutes: Check took 736 seconds, then Nix took another
725 seconds. Installer builds also started only after Check completed. Another
[baseline](https://github.com/crvouga/workspace/actions/runs/40117121865) spent
roughly three minutes enabling Windows Media Foundation during Playwright setup.
These are historical measurements, not measurements of the new pipeline.

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

Check aggregates all core lanes. A conditional lane may skip only when its filter
is explicitly false. Failure, cancellation, missing filters and unexpected skips
fail the gate. Fleet also requires successful Nix/installer matrices and any
required release. Required continues to cover Check and Fleet for the existing
ruleset. Publishing still waits for successful validation. Optional credentials
never enter task caches and their probes do not delay required statuses.

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
reuse a stale formatting pass.

Bun download caches are partitioned by OS, architecture, tool version and lockfile.
Every install still uses the frozen lockfile. Installer Python build dependencies
use setup-python's pip cache.

Each package lane restores `.turbo` from earlier runs, then always invokes Turbo.
Turbo decides reuse from task inputs and dependency hashes. Successful task
entries are saved even when a different task fails, so retries retain valid work. Shared ESLint rules
and strict TypeScript settings invalidate task results; Fleet and infrastructure
checks also track the repository files they inspect outside their package.
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
This avoids transferring multi-gigabyte Nix stores for unchanged test results.

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
