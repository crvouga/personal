# dev-fleet extraction plan

Status: **in progress.** Generated from `origin/main` at `2f33311f`, then
updated for the decisions made on 2026-11-10.

## Decisions

- dev-fleet **assumes** a macOS manager, Tailscale, the CLI proxy, the agent
  launchers and T3. They are part of the product, not plugins.
- dev-fleet is **decoupled from one person's setup**: no account, hostname,
  domain, tailnet name or repository of this fleet in its code. Those live in
  the consumer's configuration.
- Vault is this fleet's choice, not the product's: secrets go through a small
  provider interface (env, file, sops-age; Vault as an external provider).
- License: MIT. History: not carried over (see step 3).

## Where each file goes

| Component                                    |   Files |     Lines |
| -------------------------------------------- | ------: | --------: |
| fleet                                        |     201 |     19851 |
| cliproxy and agent launchers                 |     136 |     17956 |
| t3                                           |      34 |      3006 |
| monitoring                                   |      29 |      3372 |
| tailscale                                    |       8 |      1023 |
| vault (to be replaced by a secrets provider) |      11 |      1098 |
| personal                                     |      70 |     11262 |
| **all**                                      | **489** | **57568** |

Everything except the last row moves to `crvouga/dev-fleet`. The personal row
stays in `crvouga/personal`: this fleet's configuration files, its pins
(`mise.toml`, the Ubuntu package snapshot), the personal CLI's non-fleet
commands, cloud inventory and docs.

## Steps and their state

1. **Inventory.** Done: this file.
2. **Remove this fleet's identity from the code, in this repository**, so
   every step can be proven with a real `fleet-sync`:
   - 2a. Endpoints, accounts and the source repository come from the fleet
     configuration (`packages/fleet/definition.json`, read only by
     `src/fleet-config.ts`). **Done.**
   - 2b. Rename launchd labels, state directories and unit names that carry
     this fleet's name. This migrates running machines, so it is its own
     change.
   - 2c. Secrets provider interface; Vault becomes one provider.
   - 2d. Source repository and package name in the proxy installer, the
     bootstrap and the scheduler.

   `scripts/fleet-identifiers.test.ts` lists every file still naming this
   fleet, grouped by 2b, 2c and 2d. The list can only shrink.

3. **Create dev-fleet** from the cleaned tree as a fresh import. History is not
   carried: the fleet paths lived under three package names and their history
   holds hostnames, the tailnet name and a once-tracked account list, so a
   fresh import is the only way to be certain none of it is published.
4. **Scrub check** on the dev-fleet tree before anything is pushed.
5. **dev-fleet README, MIT license, CI, Renovate, release workflow.**
6. **This repository consumes dev-fleet** at a pinned revision and keeps only
   its configuration.
7. **End-to-end verification**: real `fleet-sync` and the fresh-box test.

## Known hard parts

- **How workers get the code.** A worker receives a Git bundle of the consumer
  repository and runs from that checkout. When the fleet code lives in
  dev-fleet, the worker must also obtain dev-fleet at the pinned revision
  (a Git dependency installed by `bun install`, or a second bundle).
- **The proxy installer assumes one repository.** It installs from a sparse Git
  worktree of this repository and audits that every installed file is tracked
  there. It has to install from dev-fleet instead.
- **T3 launcher paths** point into the checkout
  (`packages/fleet/agents/claude-proxy`); they move with the code and each
  worker's T3 restarts once.
- **Names on running machines** (launchd labels, `~/.local/share/personal`,
  `/etc/personal-fleet`, systemd unit names) need a migration, not a rename.

## Every file

### fleet (201 files)

| File                                                       | Lines | Destination                               |
| ---------------------------------------------------------- | ----: | ----------------------------------------- |
| `.github/workflows/toolchain.yml`                          |    82 | .github/workflows/toolchain.yml           |
| `packages/fleet/AGENTS.md`                                 |    18 | ./AGENTS.md                               |
| `packages/fleet/README.md`                                 |   273 | ./README.md                               |
| `packages/fleet/definition.schema.json`                    |   193 | ./definition.schema.json                  |
| `packages/fleet/docs/access-and-repair-research.md`        |   129 | docs/access-and-repair-research.md        |
| `packages/fleet/docs/topology.md`                          |    63 | docs/topology.md                          |
| `packages/fleet/docs/ubuntu-sync.md`                       |   334 | docs/ubuntu-sync.md                       |
| `packages/fleet/docs/worker-contract.md`                   |    64 | docs/worker-contract.md                   |
| `packages/fleet/eslint.config.js`                          |     4 | ./eslint.config.js                        |
| `packages/fleet/fleet.example.json`                        |    14 | ./fleet.example.json                      |
| `packages/fleet/macos/manager.yml`                         |    31 | ansible/macos/manager.yml                 |
| `packages/fleet/macos/policy.json`                         |    18 | ansible/macos/policy.json                 |
| `packages/fleet/net/remote-probe.sh`                       |    14 | ansible/net/remote-probe.sh               |
| `packages/fleet/package.json`                              |    21 | ./package.json                            |
| `packages/fleet/schema.json`                               |    78 | ./schema.json                             |
| `packages/fleet/src/boundary.test.ts`                      |    32 | src/boundary.test.ts                      |
| `packages/fleet/src/cli.test.ts`                           |   147 | src/cli.test.ts                           |
| `packages/fleet/src/config.test.ts`                        |    78 | src/config.test.ts                        |
| `packages/fleet/src/config.ts`                             |   187 | src/config.ts                             |
| `packages/fleet/src/configure.test.ts`                     |   143 | src/configure.test.ts                     |
| `packages/fleet/src/configure.ts`                          |   256 | src/configure.ts                          |
| `packages/fleet/src/definition.test.ts`                    |    84 | src/definition.test.ts                    |
| `packages/fleet/src/definition.ts`                         |   218 | src/definition.ts                         |
| `packages/fleet/src/diagnostics.test.ts`                   |    53 | src/diagnostics.test.ts                   |
| `packages/fleet/src/diagnostics.ts`                        |    93 | src/diagnostics.ts                        |
| `packages/fleet/src/doctor-check.ts`                       |    11 | src/doctor-check.ts                       |
| `packages/fleet/src/errors.ts`                             |     2 | src/errors.ts                             |
| `packages/fleet/src/fingerprint.ts`                        |   121 | src/fingerprint.ts                        |
| `packages/fleet/src/index.ts`                              |     7 | src/index.ts                              |
| `packages/fleet/src/input-hashes.ts`                       |    74 | src/input-hashes.ts                       |
| `packages/fleet/src/machine-health.ts`                     |    96 | src/machine-health.ts                     |
| `packages/fleet/src/machine/local-source.test.ts`          |    42 | src/machine/local-source.test.ts          |
| `packages/fleet/src/machine/local-source.ts`               |    43 | src/machine/local-source.ts               |
| `packages/fleet/src/machine/lock-error.ts`                 |     3 | src/machine/lock-error.ts                 |
| `packages/fleet/src/machine/platform.test.ts`              |    39 | src/machine/platform.test.ts              |
| `packages/fleet/src/machine/platform.ts`                   |    45 | src/machine/platform.ts                   |
| `packages/fleet/src/machine/source.ts`                     |    68 | src/machine/source.ts                     |
| `packages/fleet/src/machine/state.test.ts`                 |    93 | src/machine/state.test.ts                 |
| `packages/fleet/src/machine/state.ts`                      |   186 | src/machine/state.ts                      |
| `packages/fleet/src/managed-source.ts`                     |    48 | src/managed-source.ts                     |
| `packages/fleet/src/manager-failure.ts`                    |    49 | src/manager-failure.ts                    |
| `packages/fleet/src/manager-sync.test.ts`                  |   275 | src/manager-sync.test.ts                  |
| `packages/fleet/src/manager-sync.ts`                       |   401 | src/manager-sync.ts                       |
| `packages/fleet/src/manager.ts`                            |    63 | src/manager.ts                            |
| `packages/fleet/src/network-definition.ts`                 |    95 | src/network-definition.ts                 |
| `packages/fleet/src/node-converge-linux.ts`                |   373 | src/node-converge-linux.ts                |
| `packages/fleet/src/node-converge-shared.ts`               |    96 | src/node-converge-shared.ts               |
| `packages/fleet/src/node-converge.ts`                      |    41 | src/node-converge.ts                      |
| `packages/fleet/src/onboard.ts`                            |    36 | src/onboard.ts                            |
| `packages/fleet/src/platform/ansible-receipt.test.ts`      |   113 | src/platform/ansible-receipt.test.ts      |
| `packages/fleet/src/platform/ansible-receipt.ts`           |   129 | src/platform/ansible-receipt.ts           |
| `packages/fleet/src/platform/ansible.test.ts`              |    54 | src/platform/ansible.test.ts              |
| `packages/fleet/src/platform/ansible.ts`                   |    63 | src/platform/ansible.ts                   |
| `packages/fleet/src/platform/darwin.ts`                    |   204 | src/platform/darwin.ts                    |
| `packages/fleet/src/platform/detect.test.ts`               |    37 | src/platform/detect.test.ts               |
| `packages/fleet/src/platform/detect.ts`                    |    12 | src/platform/detect.ts                    |
| `packages/fleet/src/platform/fallback.ts`                  |   111 | src/platform/fallback.ts                  |
| `packages/fleet/src/platform/index.ts`                     |    39 | src/platform/index.ts                     |
| `packages/fleet/src/platform/launchd.ts`                   |    99 | src/platform/launchd.ts                   |
| `packages/fleet/src/platform/linux.ts`                     |   140 | src/platform/linux.ts                     |
| `packages/fleet/src/platform/ps.ts`                        |    46 | src/platform/ps.ts                        |
| `packages/fleet/src/platform/resource-verify.test.ts`      |    67 | src/platform/resource-verify.test.ts      |
| `packages/fleet/src/platform/resource-verify.ts`           |   129 | src/platform/resource-verify.ts           |
| `packages/fleet/src/platform/systemd-user.ts`              |    96 | src/platform/systemd-user.ts              |
| `packages/fleet/src/platform/types.ts`                     |   124 | src/platform/types.ts                     |
| `packages/fleet/src/platform/ubuntu-audit.test.ts`         |    38 | src/platform/ubuntu-audit.test.ts         |
| `packages/fleet/src/platform/ubuntu-audit.ts`              |    64 | src/platform/ubuntu-audit.ts              |
| `packages/fleet/src/platform/ubuntu-verify.test.ts`        |    48 | src/platform/ubuntu-verify.test.ts        |
| `packages/fleet/src/platform/ubuntu-verify.ts`             |   106 | src/platform/ubuntu-verify.ts             |
| `packages/fleet/src/platform/windows.ts`                   |   149 | src/platform/windows.ts                   |
| `packages/fleet/src/power-recovery.ts`                     |    56 | src/power-recovery.ts                     |
| `packages/fleet/src/probe.test.ts`                         |   169 | src/probe.test.ts                         |
| `packages/fleet/src/probe.ts`                              |    52 | src/probe.ts                              |
| `packages/fleet/src/protocol.ts`                           |   120 | src/protocol.ts                           |
| `packages/fleet/src/remote-bootstrap.test.ts`              |   171 | src/remote-bootstrap.test.ts              |
| `packages/fleet/src/remote-bootstrap.ts`                   |   219 | src/remote-bootstrap.ts                   |
| `packages/fleet/src/remote-entry.ts`                       |    90 | src/remote-entry.ts                       |
| `packages/fleet/src/remote-lock.test.ts`                   |    27 | src/remote-lock.test.ts                   |
| `packages/fleet/src/remote-lock.ts`                        |    13 | src/remote-lock.ts                        |
| `packages/fleet/src/repair-catalog.ts`                     |   218 | src/repair-catalog.ts                     |
| `packages/fleet/src/repair-plan.ts`                        |    79 | src/repair-plan.ts                        |
| `packages/fleet/src/repair-runner.ts`                      |    85 | src/repair-runner.ts                      |
| `packages/fleet/src/repair.test.ts`                        |   195 | src/repair.test.ts                        |
| `packages/fleet/src/report.test.ts`                        |    73 | src/report.test.ts                        |
| `packages/fleet/src/report.ts`                             |    72 | src/report.ts                             |
| `packages/fleet/src/runner.test.ts`                        |    84 | src/runner.test.ts                        |
| `packages/fleet/src/runner.ts`                             |   105 | src/runner.ts                             |
| `packages/fleet/src/ssh.test.ts`                           |    95 | src/ssh.test.ts                           |
| `packages/fleet/src/ssh.ts`                                |   136 | src/ssh.ts                                |
| `packages/fleet/src/sync.test.ts`                          |    94 | src/sync.test.ts                          |
| `packages/fleet/src/sync.ts`                               |   105 | src/sync.ts                               |
| `packages/fleet/src/test-fixtures.ts`                      |    37 | src/test-fixtures.ts                      |
| `packages/fleet/src/toolchain-checks.ts`                   |    84 | src/toolchain-checks.ts                   |
| `packages/fleet/src/topology.ts`                           |    25 | src/topology.ts                           |
| `packages/fleet/src/transport.ts`                          |   123 | src/transport.ts                          |
| `packages/fleet/src/types.ts`                              |    96 | src/types.ts                              |
| `packages/fleet/src/worker-capacity.ts`                    |    36 | src/worker-capacity.ts                    |
| `packages/fleet/src/worker-host-checks.test.ts`            |    20 | src/worker-host-checks.test.ts            |
| `packages/fleet/src/worker-host-checks.ts`                 |   177 | src/worker-host-checks.ts                 |
| `packages/fleet/src/worker-policy.test.ts`                 |   127 | src/worker-policy.test.ts                 |
| `packages/fleet/src/worker-policy.ts`                      |    65 | src/worker-policy.ts                      |
| `packages/fleet/src/worker-readiness.ts`                   |    64 | src/worker-readiness.ts                   |
| `packages/fleet/src/workstation-checks.test.ts`            |    49 | src/workstation-checks.test.ts            |
| `packages/fleet/src/workstation-checks.ts`                 |    98 | src/workstation-checks.ts                 |
| `packages/fleet/tsconfig.json`                             |     5 | ./tsconfig.json                           |
| `packages/fleet/ubuntu/authorize-sudo.sh`                  |    52 | ansible/ubuntu/authorize-sudo.sh          |
| `packages/fleet/ubuntu/baseline.yml`                       |    90 | ansible/ubuntu/baseline.yml               |
| `packages/fleet/ubuntu/disk-guard.py`                      |   105 | ansible/ubuntu/disk-guard.py              |
| `packages/fleet/ubuntu/disk-guard.test.ts`                 |    78 | ansible/ubuntu/disk-guard.test.ts         |
| `packages/fleet/ubuntu/recovery.yml`                       |    16 | ansible/ubuntu/recovery.yml               |
| `packages/fleet/ubuntu/tasks/credentials.yml`              |    48 | ansible/ubuntu/tasks/credentials.yml      |
| `packages/fleet/ubuntu/tasks/docker.yml`                   |    32 | ansible/ubuntu/tasks/docker.yml           |
| `packages/fleet/ubuntu/tasks/packages.yml`                 |    57 | ansible/ubuntu/tasks/packages.yml         |
| `packages/fleet/ubuntu/tasks/power.yml`                    |    52 | ansible/ubuntu/tasks/power.yml            |
| `packages/fleet/ubuntu/tasks/recovery.yml`                 |    40 | ansible/ubuntu/tasks/recovery.yml         |
| `packages/fleet/ubuntu/tasks/resources.yml`                |   253 | ansible/ubuntu/tasks/resources.yml        |
| `packages/fleet/ubuntu/tasks/services.yml`                 |    32 | ansible/ubuntu/tasks/services.yml         |
| `packages/fleet/ubuntu/tasks/ssh.yml`                      |    72 | ansible/ubuntu/tasks/ssh.yml              |
| `packages/fleet/ubuntu/tasks/user.yml`                     |   121 | ansible/ubuntu/tasks/user.yml             |
| `packages/fleet/ubuntu/tests/Dockerfile`                   |     5 | ansible/ubuntu/tests/Dockerfile           |
| `packages/fleet/ubuntu/tests/README.md`                    |   119 | ansible/ubuntu/tests/README.md            |
| `packages/fleet/ubuntu/tests/bootstrap-check.ts`           |    50 | ansible/ubuntu/tests/bootstrap-check.ts   |
| `packages/fleet/ubuntu/tests/fresh-box.Dockerfile`         |    11 | ansible/ubuntu/tests/fresh-box.Dockerfile |
| `packages/fleet/ubuntu/tests/fresh-box.ts`                 |   116 | ansible/ubuntu/tests/fresh-box.ts         |
| `packages/fleet/ubuntu/tests/runtime-check.ts`             |    21 | ansible/ubuntu/tests/runtime-check.ts     |
| `packages/fleet/ubuntu/tests/vm.py`                        |   224 | ansible/ubuntu/tests/vm.py                |
| `packages/personal-cli/src/app.ts`                         |   126 | src/cli/app.ts                            |
| `packages/personal-cli/src/cli.ts`                         |    22 | src/cli/cli.ts                            |
| `packages/personal-cli/src/command-index.ts`               |    58 | src/cli/command-index.ts                  |
| `packages/personal-cli/src/contracts.ts`                   |    26 | src/cli/contracts.ts                      |
| `packages/personal-cli/src/fleet-reference.ts`             |    18 | src/cli/fleet-reference.ts                |
| `packages/personal-cli/src/fleet-sync-checkout.ts`         |    90 | src/cli/fleet-sync-checkout.ts            |
| `packages/personal-cli/src/fleet-sync-enrollment.ts`       |   146 | src/cli/fleet-sync-enrollment.ts          |
| `packages/personal-cli/src/fleet-sync-forward.ts`          |   135 | src/cli/fleet-sync-forward.ts             |
| `packages/personal-cli/src/fleet-sync-manager.ts`          |   194 | src/cli/fleet-sync-manager.ts             |
| `packages/personal-cli/src/fleet-sync-output.ts`           |   315 | src/cli/fleet-sync-output.ts              |
| `packages/personal-cli/src/fleet-sync-privilege.ts`        |    28 | src/cli/fleet-sync-privilege.ts           |
| `packages/personal-cli/src/fleet-sync-progress.ts`         |   110 | src/cli/fleet-sync-progress.ts            |
| `packages/personal-cli/src/fleet-sync-remote.ts`           |   242 | src/cli/fleet-sync-remote.ts              |
| `packages/personal-cli/src/fleet-sync-report.ts`           |    27 | src/cli/fleet-sync-report.ts              |
| `packages/personal-cli/src/fleet-sync-schedule.ts`         |   139 | src/cli/fleet-sync-schedule.ts            |
| `packages/personal-cli/src/fleet-sync.ts`                  |   316 | src/cli/fleet-sync.ts                     |
| `packages/personal-cli/src/fleet.ts`                       |   173 | src/cli/fleet.ts                          |
| `packages/personal-cli/src/managed-health.ts`              |   222 | src/cli/managed-health.ts                 |
| `packages/personal-cli/src/node-deployment.ts`             |    35 | src/cli/node-deployment.ts                |
| `packages/personal-cli/src/node-sync.ts`                   |   122 | src/cli/node-sync.ts                      |
| `packages/personal-cli/src/options.ts`                     |   142 | src/cli/options.ts                        |
| `packages/personal-cli/src/probe-source.ts`                |     8 | src/cli/probe-source.ts                   |
| `packages/personal-cli/src/program.ts`                     |   167 | src/cli/program.ts                        |
| `packages/personal-cli/src/register-fleet.ts`              |   247 | src/cli/register-fleet.ts                 |
| `packages/personal-cli/src/registry.ts`                    |   167 | src/cli/registry.ts                       |
| `packages/personal-cli/src/repair-apply.ts`                |    68 | src/cli/repair-apply.ts                   |
| `packages/personal-cli/src/repair-guard.ts`                |    12 | src/cli/repair-guard.ts                   |
| `packages/personal-cli/src/repair-inspect.ts`              |   151 | src/cli/repair-inspect.ts                 |
| `packages/personal-cli/src/repair-script.ts`               |    77 | src/cli/repair-script.ts                  |
| `packages/personal-cli/src/repair.ts`                      |   216 | src/cli/repair.ts                         |
| `packages/personal-cli/src/roster.ts`                      |    90 | src/cli/roster.ts                         |
| `packages/personal-cli/src/search.ts`                      |    36 | src/cli/search.ts                         |
| `packages/personal-cli/src/settings.ts`                    |    47 | src/cli/settings.ts                       |
| `packages/personal-cli/src/ui-actions.ts`                  |   134 | src/cli/ui-actions.ts                     |
| `packages/personal-cli/src/ui-controller.ts`               |   113 | src/cli/ui-controller.ts                  |
| `packages/personal-cli/src/ui-data.ts`                     |   107 | src/cli/ui-data.ts                        |
| `packages/personal-cli/src/ui-execute.ts`                  |   164 | src/cli/ui-execute.ts                     |
| `packages/personal-cli/src/ui-repairs.ts`                  |    35 | src/cli/ui-repairs.ts                     |
| `packages/personal-cli/src/ui-reports.ts`                  |   212 | src/cli/ui-reports.ts                     |
| `packages/personal-cli/src/ui-targets.ts`                  |   101 | src/cli/ui-targets.ts                     |
| `packages/personal-cli/src/ui-terminal.ts`                 |   110 | src/cli/ui-terminal.ts                    |
| `packages/personal-cli/src/ui-types.ts`                    |    50 | src/cli/ui-types.ts                       |
| `packages/personal-cli/src/ui-wizard.ts`                   |   102 | src/cli/ui-wizard.ts                      |
| `packages/personal-cli/src/ui.ts`                          |    10 | src/cli/ui.ts                             |
| `packages/personal-cli/src/worker-health-output.ts`        |    38 | src/cli/worker-health-output.ts           |
| `packages/personal-cli/tests/commands.test.ts`             |   255 | tests/cli/commands.test.ts                |
| `packages/personal-cli/tests/diagnostics.test.ts`          |   111 | tests/cli/diagnostics.test.ts             |
| `packages/personal-cli/tests/fleet-enrollment.test.ts`     |    36 | tests/cli/fleet-enrollment.test.ts        |
| `packages/personal-cli/tests/fleet-safety.test.ts`         |    33 | tests/cli/fleet-safety.test.ts            |
| `packages/personal-cli/tests/fleet-schedule.test.ts`       |    56 | tests/cli/fleet-schedule.test.ts          |
| `packages/personal-cli/tests/fleet-sync-forward.test.ts`   |   170 | tests/cli/fleet-sync-forward.test.ts      |
| `packages/personal-cli/tests/fleet-sync-manager.test.ts`   |   134 | tests/cli/fleet-sync-manager.test.ts      |
| `packages/personal-cli/tests/fleet-sync-output.test.ts`    |   125 | tests/cli/fleet-sync-output.test.ts       |
| `packages/personal-cli/tests/fleet-sync-privilege.test.ts` |    40 | tests/cli/fleet-sync-privilege.test.ts    |
| `packages/personal-cli/tests/fleet-sync.test.ts`           |   115 | tests/cli/fleet-sync.test.ts              |
| `packages/personal-cli/tests/managed-health.test.ts`       |    49 | tests/cli/managed-health.test.ts          |
| `packages/personal-cli/tests/node-sync.test.ts`            |   157 | tests/cli/node-sync.test.ts               |
| `packages/personal-cli/tests/npm.test.ts`                  |    68 | tests/cli/npm.test.ts                     |
| `packages/personal-cli/tests/release-diagnostics.test.ts`  |    37 | tests/cli/release-diagnostics.test.ts     |
| `packages/personal-cli/tests/repairs.test.ts`              |   348 | tests/cli/repairs.test.ts                 |
| `scripts/dev/bootstrap.sh`                                 |    72 | bootstrap/bootstrap.sh                    |
| `scripts/dev/doctor.ts`                                    |   160 | bootstrap/doctor.ts                       |
| `scripts/dev/fleet-manager-run.sh`                         |    71 | bootstrap/fleet-manager-run.sh            |
| `scripts/dev/fleet-remote-bootstrap.sh`                    |   186 | bootstrap/fleet-remote-bootstrap.sh       |
| `scripts/dev/global-config.ts`                             |    65 | bootstrap/global-config.ts                |
| `scripts/dev/setup-status.test.ts`                         |    48 | bootstrap/setup-status.test.ts            |
| `scripts/dev/setup-status.ts`                              |    52 | bootstrap/setup-status.ts                 |
| `scripts/dev/setup.test.ts`                                |   181 | bootstrap/setup.test.ts                   |
| `scripts/dev/setup.ts`                                     |    89 | bootstrap/setup.ts                        |
| `scripts/dev/shell-path.test.ts`                           |   119 | bootstrap/shell-path.test.ts              |
| `scripts/dev/shell-path.ts`                                |   107 | bootstrap/shell-path.ts                   |
| `scripts/dev/worker-tools.ts`                              |    25 | bootstrap/worker-tools.ts                 |
| `scripts/fleet-guide.test.ts`                              |    40 | tests/fleet-guide.test.ts                 |
| `scripts/fleet-playbooks.test.ts`                          |    50 | tests/fleet-playbooks.test.ts             |
| `scripts/worker-policy.test.ts`                            |    44 | tests/worker-policy.test.ts               |

### cliproxy and agent launchers (136 files)

| File                                                                         | Lines | Destination                                                 |
| ---------------------------------------------------------------------------- | ----: | ----------------------------------------------------------- |
| `.github/workflows/cliproxy-health.yml`                                      |   186 | .github/workflows/cliproxy-health.yml                       |
| `packages/cliproxy-fleet/.gitignore`                                         |     4 | cliproxy/.gitignore                                         |
| `packages/cliproxy-fleet/AGENTS.md`                                          |    12 | cliproxy/AGENTS.md                                          |
| `packages/cliproxy-fleet/README.md`                                          |   270 | cliproxy/README.md                                          |
| `packages/cliproxy-fleet/clients/bootstrap.py`                               |   144 | cliproxy/clients/bootstrap.py                               |
| `packages/cliproxy-fleet/clients/launcher.py`                                |    58 | cliproxy/clients/launcher.py                                |
| `packages/cliproxy-fleet/compose.yaml`                                       |    91 | cliproxy/compose.yaml                                       |
| `packages/cliproxy-fleet/config.template.yaml`                               |    71 | cliproxy/config.template.yaml                               |
| `packages/cliproxy-fleet/docs/cloud-adoption.md`                             |    17 | cliproxy/docs/cloud-adoption.md                             |
| `packages/cliproxy-fleet/docs/deployment-verification-2026-11-04.md`         |    61 | cliproxy/docs/deployment-verification-2026-11-04.md         |
| `packages/cliproxy-fleet/docs/deployment.png`                                |  1117 | cliproxy/docs/deployment.png                                |
| `packages/cliproxy-fleet/docs/deployment.svg`                                |   110 | cliproxy/docs/deployment.svg                                |
| `packages/cliproxy-fleet/docs/migration.md`                                  |   132 | cliproxy/docs/migration.md                                  |
| `packages/cliproxy-fleet/docs/model-health-report.schema.json`               |   365 | cliproxy/docs/model-health-report.schema.json               |
| `packages/cliproxy-fleet/docs/model-health.md`                               |   394 | cliproxy/docs/model-health.md                               |
| `packages/cliproxy-fleet/image.lock.json`                                    |     6 | cliproxy/image.lock.json                                    |
| `packages/cliproxy-fleet/launchd/dev.chrisvouga.cliproxy-backup-check.plist` |    39 | cliproxy/launchd/dev.chrisvouga.cliproxy-backup-check.plist |
| `packages/cliproxy-fleet/launchd/dev.chrisvouga.cliproxy-backup.plist`       |    49 | cliproxy/launchd/dev.chrisvouga.cliproxy-backup.plist       |
| `packages/cliproxy-fleet/launchd/dev.chrisvouga.cliproxy-fleet.plist`        |    33 | cliproxy/launchd/dev.chrisvouga.cliproxy-fleet.plist        |
| `packages/cliproxy-fleet/launchd/dev.chrisvouga.cliproxy-gc.plist`           |    39 | cliproxy/launchd/dev.chrisvouga.cliproxy-gc.plist           |
| `packages/cliproxy-fleet/launchd/dev.chrisvouga.cliproxy-monitor.plist`      |    30 | cliproxy/launchd/dev.chrisvouga.cliproxy-monitor.plist      |
| `packages/cliproxy-fleet/launchd/dev.chrisvouga.cliproxy-vault-renew.plist`  |    32 | cliproxy/launchd/dev.chrisvouga.cliproxy-vault-renew.plist  |
| `packages/cliproxy-fleet/package.json`                                       |    12 | cliproxy/package.json                                       |
| `packages/cliproxy-fleet/requirements.lock`                                  |    79 | cliproxy/requirements.lock                                  |
| `packages/cliproxy-fleet/scripts/accounts.py`                                |    39 | cliproxy/scripts/accounts.py                                |
| `packages/cliproxy-fleet/scripts/audit.py`                                   |   124 | cliproxy/scripts/audit.py                                   |
| `packages/cliproxy-fleet/scripts/backup`                                     |   235 | cliproxy/scripts/backup                                     |
| `packages/cliproxy-fleet/scripts/check.py`                                   |    35 | cliproxy/scripts/check.py                                   |
| `packages/cliproxy-fleet/scripts/checkpoint.py`                              |   227 | cliproxy/scripts/checkpoint.py                              |
| `packages/cliproxy-fleet/scripts/cli.py`                                     |    65 | cliproxy/scripts/cli.py                                     |
| `packages/cliproxy-fleet/scripts/cliproxy_host.py`                           |   258 | cliproxy/scripts/cliproxy_host.py                           |
| `packages/cliproxy-fleet/scripts/cloud_state.py`                             |   142 | cliproxy/scripts/cloud_state.py                             |
| `packages/cliproxy-fleet/scripts/container-health`                           |     7 | cliproxy/scripts/container-health                           |
| `packages/cliproxy-fleet/scripts/docker`                                     |    25 | cliproxy/scripts/docker                                     |
| `packages/cliproxy-fleet/scripts/external-health.py`                         |    84 | cliproxy/scripts/external-health.py                         |
| `packages/cliproxy-fleet/scripts/fleet_sync.py`                              |   275 | cliproxy/scripts/fleet_sync.py                              |
| `packages/cliproxy-fleet/scripts/initialize`                                 |    84 | cliproxy/scripts/initialize                                 |
| `packages/cliproxy-fleet/scripts/install-dependencies`                       |    49 | cliproxy/scripts/install-dependencies                       |
| `packages/cliproxy-fleet/scripts/install.py`                                 |   407 | cliproxy/scripts/install.py                                 |
| `packages/cliproxy-fleet/scripts/model_health.py`                            |    17 | cliproxy/scripts/model_health.py                            |
| `packages/cliproxy-fleet/scripts/modelhealth/__init__.py`                    |     6 | cliproxy/scripts/modelhealth/**init**.py                    |
| `packages/cliproxy-fleet/scripts/modelhealth/checks.py`                      |   430 | cliproxy/scripts/modelhealth/checks.py                      |
| `packages/cliproxy-fleet/scripts/modelhealth/cli.py`                         |   118 | cliproxy/scripts/modelhealth/cli.py                         |
| `packages/cliproxy-fleet/scripts/modelhealth/config.py`                      |   180 | cliproxy/scripts/modelhealth/config.py                      |
| `packages/cliproxy-fleet/scripts/modelhealth/emulator.py`                    |   537 | cliproxy/scripts/modelhealth/emulator.py                    |
| `packages/cliproxy-fleet/scripts/modelhealth/expect.py`                      |    89 | cliproxy/scripts/modelhealth/expect.py                      |
| `packages/cliproxy-fleet/scripts/modelhealth/findings.py`                    |   184 | cliproxy/scripts/modelhealth/findings.py                    |
| `packages/cliproxy-fleet/scripts/modelhealth/protocol.py`                    |   331 | cliproxy/scripts/modelhealth/protocol.py                    |
| `packages/cliproxy-fleet/scripts/modelhealth/redact.py`                      |    29 | cliproxy/scripts/modelhealth/redact.py                      |
| `packages/cliproxy-fleet/scripts/modelhealth/report.py`                      |   151 | cliproxy/scripts/modelhealth/report.py                      |
| `packages/cliproxy-fleet/scripts/modelhealth/runner.py`                      |   391 | cliproxy/scripts/modelhealth/runner.py                      |
| `packages/cliproxy-fleet/scripts/modelhealth/scenario.py`                    |   132 | cliproxy/scripts/modelhealth/scenario.py                    |
| `packages/cliproxy-fleet/scripts/modelhealth/schema.py`                      |    64 | cliproxy/scripts/modelhealth/schema.py                      |
| `packages/cliproxy-fleet/scripts/modelhealth/simulate.py`                    |   112 | cliproxy/scripts/modelhealth/simulate.py                    |
| `packages/cliproxy-fleet/scripts/modelhealth/transport.py`                   |   214 | cliproxy/scripts/modelhealth/transport.py                   |
| `packages/cliproxy-fleet/scripts/monitor`                                    |    69 | cliproxy/scripts/monitor                                    |
| `packages/cliproxy-fleet/scripts/ops`                                        |   528 | cliproxy/scripts/ops                                        |
| `packages/cliproxy-fleet/scripts/public-endpoint`                            |   127 | cliproxy/scripts/public-endpoint                            |
| `packages/cliproxy-fleet/scripts/recover_node.py`                            |   178 | cliproxy/scripts/recover_node.py                            |
| `packages/cliproxy-fleet/scripts/restore-verify`                             |    61 | cliproxy/scripts/restore-verify                             |
| `packages/cliproxy-fleet/scripts/retention.py`                               |   145 | cliproxy/scripts/retention.py                               |
| `packages/cliproxy-fleet/scripts/service-start`                              |     8 | cliproxy/scripts/service-start                              |
| `packages/cliproxy-fleet/scripts/validate-config`                            |    57 | cliproxy/scripts/validate-config                            |
| `packages/cliproxy-fleet/scripts/vault-access.py`                            |    58 | cliproxy/scripts/vault-access.py                            |
| `packages/cliproxy-fleet/scripts/vault-backup-login`                         |    55 | cliproxy/scripts/vault-backup-login                         |
| `packages/cliproxy-fleet/scripts/vault-recovery`                             |    56 | cliproxy/scripts/vault-recovery                             |
| `packages/cliproxy-fleet/scripts/vault-renew`                                |    31 | cliproxy/scripts/vault-renew                                |
| `packages/cliproxy-fleet/systemd/cliproxy-backup-check.service`              |    11 | cliproxy/systemd/cliproxy-backup-check.service              |
| `packages/cliproxy-fleet/systemd/cliproxy-backup-check.timer`                |     9 | cliproxy/systemd/cliproxy-backup-check.timer                |
| `packages/cliproxy-fleet/systemd/cliproxy-backup.service`                    |    14 | cliproxy/systemd/cliproxy-backup.service                    |
| `packages/cliproxy-fleet/systemd/cliproxy-backup.timer`                      |     9 | cliproxy/systemd/cliproxy-backup.timer                      |
| `packages/cliproxy-fleet/systemd/cliproxy-fleet.service`                     |    18 | cliproxy/systemd/cliproxy-fleet.service                     |
| `packages/cliproxy-fleet/systemd/cliproxy-gc.service`                        |    14 | cliproxy/systemd/cliproxy-gc.service                        |
| `packages/cliproxy-fleet/systemd/cliproxy-gc.timer`                          |     9 | cliproxy/systemd/cliproxy-gc.timer                          |
| `packages/cliproxy-fleet/systemd/cliproxy-monitor.service`                   |     9 | cliproxy/systemd/cliproxy-monitor.service                   |
| `packages/cliproxy-fleet/systemd/cliproxy-monitor.timer`                     |     8 | cliproxy/systemd/cliproxy-monitor.timer                     |
| `packages/cliproxy-fleet/systemd/cliproxy-vault-renew.service`               |     9 | cliproxy/systemd/cliproxy-vault-renew.service               |
| `packages/cliproxy-fleet/systemd/cliproxy-vault-renew.timer`                 |     8 | cliproxy/systemd/cliproxy-vault-renew.timer                 |
| `packages/cliproxy-fleet/tests/live.py`                                      |   221 | cliproxy/tests/live.py                                      |
| `packages/cliproxy-fleet/tests/modelhealth_support.py`                       |    73 | cliproxy/tests/modelhealth_support.py                       |
| `packages/cliproxy-fleet/tests/test_accounts.py`                             |    40 | cliproxy/tests/test_accounts.py                             |
| `packages/cliproxy-fleet/tests/test_backup.py`                               |   176 | cliproxy/tests/test_backup.py                               |
| `packages/cliproxy-fleet/tests/test_checkpoint.py`                           |   319 | cliproxy/tests/test_checkpoint.py                           |
| `packages/cliproxy-fleet/tests/test_clients.py`                              |   103 | cliproxy/tests/test_clients.py                              |
| `packages/cliproxy-fleet/tests/test_cloud_operations.py`                     |   295 | cliproxy/tests/test_cloud_operations.py                     |
| `packages/cliproxy-fleet/tests/test_fleet_sync.py`                           |   212 | cliproxy/tests/test_fleet_sync.py                           |
| `packages/cliproxy-fleet/tests/test_install.py`                              |   192 | cliproxy/tests/test_install.py                              |
| `packages/cliproxy-fleet/tests/test_macos_host.py`                           |   233 | cliproxy/tests/test_macos_host.py                           |
| `packages/cliproxy-fleet/tests/test_model_agent_report.py`                   |   176 | cliproxy/tests/test_model_agent_report.py                   |
| `packages/cliproxy-fleet/tests/test_model_config.py`                         |   110 | cliproxy/tests/test_model_config.py                         |
| `packages/cliproxy-fleet/tests/test_model_health.py`                         |   375 | cliproxy/tests/test_model_health.py                         |
| `packages/cliproxy-fleet/tests/test_model_protocol.py`                       |   259 | cliproxy/tests/test_model_protocol.py                       |
| `packages/cliproxy-fleet/tests/test_model_routing.py`                        |    97 | cliproxy/tests/test_model_routing.py                        |
| `packages/cliproxy-fleet/tests/test_public_endpoint.py`                      |    31 | cliproxy/tests/test_public_endpoint.py                      |
| `packages/cliproxy-fleet/tests/test_retention.py`                            |   227 | cliproxy/tests/test_retention.py                            |
| `packages/cliproxy-fleet/tests/test_validation.py`                           |    65 | cliproxy/tests/test_validation.py                           |
| `packages/cliproxy-fleet/vendor/LICENSE`                                     |    22 | cliproxy/vendor/LICENSE                                     |
| `packages/cliproxy-fleet/vendor/config.upstream.yaml`                        |  1350 | cliproxy/vendor/config.upstream.yaml                        |
| `packages/fleet/agents/antigravity-proxy.ts`                                 |     4 | agents/antigravity-proxy.ts                                 |
| `packages/fleet/agents/audit.md`                                             |    90 | agents/audit.md                                             |
| `packages/fleet/agents/claude-proxy`                                         |     6 | agents/claude-proxy                                         |
| `packages/fleet/agents/claude-proxy.ts`                                      |     4 | agents/claude-proxy.ts                                      |
| `packages/fleet/agents/codex-proxy.ts`                                       |     4 | agents/codex-proxy.ts                                       |
| `packages/fleet/agents/grok-proxy.ts`                                        |     4 | agents/grok-proxy.ts                                        |
| `packages/fleet/agents/managed-proxy.ts`                                     |    56 | agents/managed-proxy.ts                                     |
| `packages/fleet/agents/opencode-proxy.ts`                                    |     4 | agents/opencode-proxy.ts                                    |
| `packages/fleet/agents/registry.schema.json`                                 |   177 | agents/registry.schema.json                                 |
| `packages/fleet/agents/setup.md`                                             |   129 | agents/setup.md                                             |
| `packages/fleet/src/agents/account-relay.ts`                                 |   112 | src/agents/account-relay.ts                                 |
| `packages/fleet/src/agents/accounts.test.ts`                                 |   236 | src/agents/accounts.test.ts                                 |
| `packages/fleet/src/agents/accounts.ts`                                      |    86 | src/agents/accounts.ts                                      |
| `packages/fleet/src/agents/agents.test.ts`                                   |   112 | src/agents/agents.test.ts                                   |
| `packages/fleet/src/agents/audit.ts`                                         |    78 | src/agents/audit.ts                                         |
| `packages/fleet/src/agents/cli.ts`                                           |    14 | src/agents/cli.ts                                           |
| `packages/fleet/src/agents/command.ts`                                       |   208 | src/agents/command.ts                                       |
| `packages/fleet/src/agents/converge.ts`                                      |   124 | src/agents/converge.ts                                      |
| `packages/fleet/src/agents/doctor.ts`                                        |   108 | src/agents/doctor.ts                                        |
| `packages/fleet/src/agents/errors.ts`                                        |     3 | src/agents/errors.ts                                        |
| `packages/fleet/src/agents/files.ts`                                         |    74 | src/agents/files.ts                                         |
| `packages/fleet/src/agents/fleet-verify.ts`                                  |   157 | src/agents/fleet-verify.ts                                  |
| `packages/fleet/src/agents/launch.ts`                                        |   291 | src/agents/launch.ts                                        |
| `packages/fleet/src/agents/native-verify.test.ts`                            |   190 | src/agents/native-verify.test.ts                            |
| `packages/fleet/src/agents/native-verify.ts`                                 |   231 | src/agents/native-verify.ts                                 |
| `packages/fleet/src/agents/provider-errors.test.ts`                          |    38 | src/agents/provider-errors.test.ts                          |
| `packages/fleet/src/agents/provider-errors.ts`                               |    51 | src/agents/provider-errors.ts                               |
| `packages/fleet/src/agents/registry.ts`                                      |    51 | src/agents/registry.ts                                      |
| `packages/fleet/src/agents/render.ts`                                        |   111 | src/agents/render.ts                                        |
| `packages/fleet/src/agents/round-trip.test.ts`                               |    63 | src/agents/round-trip.test.ts                               |
| `packages/fleet/src/agents/round-trip.ts`                                    |   193 | src/agents/round-trip.ts                                    |
| `packages/fleet/src/agents/toolchain.ts`                                     |    35 | src/agents/toolchain.ts                                     |
| `packages/fleet/src/agents/verify-cache.test.ts`                             |    75 | src/agents/verify-cache.test.ts                             |
| `packages/fleet/src/agents/verify-cache.ts`                                  |   104 | src/agents/verify-cache.ts                                  |
| `packages/fleet/src/agents/verify.test.ts`                                   |    21 | src/agents/verify.test.ts                                   |
| `packages/fleet/src/agents/verify.ts`                                        |   128 | src/agents/verify.ts                                        |
| `packages/fleet/src/proxy-converge.test.ts`                                  |    40 | src/proxy-converge.test.ts                                  |
| `packages/fleet/src/proxy-converge.ts`                                       |    85 | src/proxy-converge.ts                                       |

### t3 (34 files)

| File                                                      | Lines | Destination                              |
| --------------------------------------------------------- | ----: | ---------------------------------------- |
| `packages/fleet/agents/t3.json`                           |    41 | agents/t3.json                           |
| `packages/fleet/src/platform/t3-policy-workspace.test.ts` |    23 | src/platform/t3-policy-workspace.test.ts |
| `packages/fleet/src/platform/t3-policy.test.ts`           |   119 | src/platform/t3-policy.test.ts           |
| `packages/fleet/src/platform/t3-policy.ts`                |   138 | src/platform/t3-policy.ts                |
| `packages/fleet/src/platform/t3-route.test.ts`            |    77 | src/platform/t3-route.test.ts            |
| `packages/fleet/src/platform/t3-route.ts`                 |    69 | src/platform/t3-route.ts                 |
| `packages/fleet/src/platform/t3-service.test.ts`          |   103 | src/platform/t3-service.test.ts          |
| `packages/fleet/src/platform/t3-service.ts`               |    76 | src/platform/t3-service.ts               |
| `packages/fleet/src/t3-endpoint.test.ts`                  |    59 | src/t3-endpoint.test.ts                  |
| `packages/fleet/src/t3-endpoint.ts`                       |    49 | src/t3-endpoint.ts                       |
| `packages/fleet/src/t3-linked-check.ts`                   |   102 | src/t3-linked-check.ts                   |
| `packages/fleet/src/t3/accounts.ts`                       |    82 | src/t3/accounts.ts                       |
| `packages/fleet/src/t3/desired.ts`                        |   166 | src/t3/desired.ts                        |
| `packages/fleet/src/t3/files.ts`                          |    82 | src/t3/files.ts                          |
| `packages/fleet/src/t3/names-check.ts`                    |    54 | src/t3/names-check.ts                    |
| `packages/fleet/src/t3/names.ts`                          |   156 | src/t3/names.ts                          |
| `packages/fleet/src/t3/plan.ts`                           |    83 | src/t3/plan.ts                           |
| `packages/fleet/src/t3/providers.ts`                      |    75 | src/t3/providers.ts                      |
| `packages/fleet/src/t3/reconcile.ts`                      |   124 | src/t3/reconcile.ts                      |
| `packages/fleet/ubuntu/t3-desktop.yml`                    |   221 | ansible/ubuntu/t3-desktop.yml            |
| `packages/fleet/ubuntu/t3-health.sh`                      |    34 | ansible/ubuntu/t3-health.sh              |
| `packages/fleet/ubuntu/t3-health.test.ts`                 |    58 | ansible/ubuntu/t3-health.test.ts         |
| `packages/fleet/ubuntu/t3-policy.yml`                     |    77 | ansible/ubuntu/t3-policy.yml             |
| `packages/fleet/ubuntu/t3-route.yml`                      |    29 | ansible/ubuntu/t3-route.yml              |
| `packages/fleet/ubuntu/t3/policy.json`                    |     8 | ansible/ubuntu/t3/policy.json            |
| `packages/personal-cli/src/node-t3.ts`                    |    32 | src/cli/node-t3.ts                       |
| `packages/personal-cli/src/t3/command.ts`                 |    96 | src/cli/t3/command.ts                    |
| `packages/personal-cli/src/t3/register.ts`                |    56 | src/cli/t3/register.ts                   |
| `packages/personal-cli/tests/t3-names.test.ts`            |   157 | tests/cli/t3-names.test.ts               |
| `packages/personal-cli/tests/t3.test.ts`                  |   290 | tests/cli/t3.test.ts                     |
| `scripts/dev/native-t3.ts`                                |   155 | bootstrap/native-t3.ts                   |
| `scripts/dev/t3-archive.test.ts`                          |    20 | bootstrap/t3-archive.test.ts             |
| `scripts/dev/test_verify_t3_archive.py`                   |    45 | bootstrap/test_verify_t3_archive.py      |
| `scripts/dev/verify-t3-archive.py`                        |    50 | bootstrap/verify-t3-archive.py           |

### monitoring (29 files)

| File                                                        | Lines | Destination                             |
| ----------------------------------------------------------- | ----: | --------------------------------------- |
| `packages/fleet/monitoring/README.md`                       |   155 | ansible/monitoring/README.md            |
| `packages/fleet/monitoring/agent-darwin.yml`                |   199 | ansible/monitoring/agent-darwin.yml     |
| `packages/fleet/monitoring/agent.yml`                       |   135 | ansible/monitoring/agent.yml            |
| `packages/fleet/monitoring/beszel-agent.service`            |    43 | ansible/monitoring/beszel-agent.service |
| `packages/fleet/monitoring/compose.yml`                     |    75 | ansible/monitoring/compose.yml          |
| `packages/fleet/monitoring/hub-darwin.yml`                  |   103 | ansible/monitoring/hub-darwin.yml       |
| `packages/fleet/monitoring/lock.json`                       |    12 | ansible/monitoring/lock.json            |
| `packages/fleet/monitoring/tests/upstream.py`               |   146 | ansible/monitoring/tests/upstream.py    |
| `packages/fleet/src/monitoring/apply.test.ts`               |   110 | src/monitoring/apply.test.ts            |
| `packages/fleet/src/monitoring/apply.ts`                    |   174 | src/monitoring/apply.ts                 |
| `packages/fleet/src/monitoring/beszel.test.ts`              |    85 | src/monitoring/beszel.test.ts           |
| `packages/fleet/src/monitoring/beszel.ts`                   |   191 | src/monitoring/beszel.ts                |
| `packages/fleet/src/monitoring/enroll.test.ts`              |    55 | src/monitoring/enroll.test.ts           |
| `packages/fleet/src/monitoring/enroll.ts`                   |   111 | src/monitoring/enroll.ts                |
| `packages/fleet/src/monitoring/hub-access.test.ts`          |    26 | src/monitoring/hub-access.test.ts       |
| `packages/fleet/src/monitoring/hub-access.ts`               |   126 | src/monitoring/hub-access.ts            |
| `packages/fleet/src/monitoring/hub-viewer.test.ts`          |    76 | src/monitoring/hub-viewer.test.ts       |
| `packages/fleet/src/monitoring/hub-viewer.ts`               |   143 | src/monitoring/hub-viewer.ts            |
| `packages/fleet/src/monitoring/hub.test.ts`                 |    65 | src/monitoring/hub.test.ts              |
| `packages/fleet/src/monitoring/hub.ts`                      |   106 | src/monitoring/hub.ts                   |
| `packages/fleet/src/monitoring/manager-agent.test.ts`       |    50 | src/monitoring/manager-agent.test.ts    |
| `packages/fleet/src/monitoring/manager-agent.ts`            |    74 | src/monitoring/manager-agent.ts         |
| `packages/fleet/src/monitoring/manager-hub.test.ts`         |   201 | src/monitoring/manager-hub.test.ts      |
| `packages/fleet/src/monitoring/manager-hub.ts`              |   233 | src/monitoring/manager-hub.ts           |
| `packages/fleet/src/monitoring/remote.test.ts`              |    97 | src/monitoring/remote.test.ts           |
| `packages/fleet/src/monitoring/remote.ts`                   |    66 | src/monitoring/remote.ts                |
| `packages/personal-cli/src/fleet-sync-monitoring.ts`        |   189 | src/cli/fleet-sync-monitoring.ts        |
| `packages/personal-cli/tests/dashboard-health.test.ts`      |    98 | tests/cli/dashboard-health.test.ts      |
| `packages/personal-cli/tests/fleet-sync-monitoring.test.ts` |   228 | tests/cli/fleet-sync-monitoring.test.ts |

### tailscale (8 files)

| File                                          | Lines | Destination                  |
| --------------------------------------------- | ----: | ---------------------------- |
| `packages/fleet/src/tailnet-health.test.ts`   |   198 | src/tailnet-health.test.ts   |
| `packages/fleet/src/tailnet-health.ts`        |   232 | src/tailnet-health.ts        |
| `packages/fleet/src/tailnet-matching.ts`      |    38 | src/tailnet-matching.ts      |
| `packages/fleet/src/tailscale.test.ts`        |   100 | src/tailscale.test.ts        |
| `packages/fleet/src/tailscale.ts`             |   142 | src/tailscale.ts             |
| `packages/fleet/ubuntu/tailscale.yml`         |    76 | ansible/ubuntu/tailscale.yml |
| `packages/personal-cli/src/tailnet.ts`        |   132 | src/cli/tailnet.ts           |
| `packages/personal-cli/tests/tailnet.test.ts` |   105 | tests/cli/tailnet.test.ts    |

### vault (to be replaced by a secrets provider) (11 files)

| File                                                   | Lines | Destination                        |
| ------------------------------------------------------ | ----: | ---------------------------------- |
| `packages/fleet/src/agents/secrets.ts`                 |    34 | src/agents/secrets.ts              |
| `packages/fleet/src/auth-checks.ts`                    |   164 | src/auth-checks.ts                 |
| `packages/fleet/src/service-auth.test.ts`              |    97 | src/service-auth.test.ts           |
| `packages/fleet/src/service-auth.ts`                   |   116 | src/service-auth.ts                |
| `packages/fleet/src/vault-config.ts`                   |    79 | src/vault-config.ts                |
| `packages/fleet/src/worker-access-checks.ts`           |   127 | src/worker-access-checks.ts        |
| `packages/personal-cli/src/fleet-sync-vault.ts`        |   164 | src/cli/fleet-sync-vault.ts        |
| `packages/personal-cli/tests/fleet-sync-vault.test.ts` |   153 | tests/cli/fleet-sync-vault.test.ts |
| `packages/personal-cli/tests/vault-routing.test.ts`    |    59 | tests/cli/vault-routing.test.ts    |
| `scripts/dev/worker-auth.ts`                           |    59 | bootstrap/worker-auth.ts           |
| `scripts/dev/worker-github.ts`                         |    46 | bootstrap/worker-github.ts         |

### personal (70 files)

| File                                                      | Lines | Destination                                             |
| --------------------------------------------------------- | ----: | ------------------------------------------------------- |
| `.agents/commands/model-health.md`                        |    43 | (stays) rewritten to point at dev-fleet                 |
| `.github/workflows/ci.yml`                                |   666 | (stays) fleet lanes removed; dev-fleet gets its own CI  |
| `AGENTS.md`                                               |    90 | (stays) rewritten to point at dev-fleet                 |
| `mise.lock`                                               |  1493 | (stays) personal pins; a starter copy goes to examples/ |
| `mise.toml`                                               |   100 | (stays) personal pins; a starter copy goes to examples/ |
| `packages/cliproxy-fleet/models.json`                     |  1620 | stays: this fleet's configuration                       |
| `packages/cliproxy-fleet/public-endpoint.json`            |     5 | stays: this fleet's configuration                       |
| `packages/fleet/agents/registry.json`                     |   217 | stays: this fleet's configuration                       |
| `packages/fleet/definition.json`                          |    67 | stays: this fleet's configuration                       |
| `packages/fleet/migrations/workstation-network-v1.json`   |    23 | stays: this fleet's configuration                       |
| `packages/fleet/ubuntu/policy.json`                       |    44 | stays: this fleet's configuration                       |
| `packages/personal-cli/AGENTS.md`                         |    12 | (stays) personal CLI: workstation, infra, release       |
| `packages/personal-cli/README.md`                         |   143 | (stays) personal CLI: workstation, infra, release       |
| `packages/personal-cli/bin.mjs`                           |    22 | (stays) personal CLI: workstation, infra, release       |
| `packages/personal-cli/eslint.config.js`                  |     4 | (stays) personal CLI: workstation, infra, release       |
| `packages/personal-cli/package.json`                      |    30 | (stays) personal CLI: workstation, infra, release       |
| `packages/personal-cli/releasing.md`                      |   176 | (stays) personal CLI: workstation, infra, release       |
| `packages/personal-cli/scripts/build.ts`                  |   121 | (stays) personal CLI: workstation, infra, release       |
| `packages/personal-cli/scripts/consumer-help.ts`          |    47 | (stays) personal CLI: workstation, infra, release       |
| `packages/personal-cli/scripts/consumer-smoke.ts`         |   214 | (stays) personal CLI: workstation, infra, release       |
| `packages/personal-cli/scripts/consumer-t3.ts`            |    57 | (stays) personal CLI: workstation, infra, release       |
| `packages/personal-cli/scripts/npm.ts`                    |    21 | (stays) personal CLI: workstation, infra, release       |
| `packages/personal-cli/scripts/pack.ts`                   |    65 | (stays) personal CLI: workstation, infra, release       |
| `packages/personal-cli/scripts/release-auth.ts`           |    66 | (stays) personal CLI: workstation, infra, release       |
| `packages/personal-cli/scripts/release-diagnostics.ts`    |    21 | (stays) personal CLI: workstation, infra, release       |
| `packages/personal-cli/scripts/release-error.ts`          |     2 | (stays) personal CLI: workstation, infra, release       |
| `packages/personal-cli/scripts/release-io.ts`             |    80 | (stays) personal CLI: workstation, infra, release       |
| `packages/personal-cli/scripts/release-model.ts`          |   149 | (stays) personal CLI: workstation, infra, release       |
| `packages/personal-cli/scripts/release-propagation.ts`    |    34 | (stays) personal CLI: workstation, infra, release       |
| `packages/personal-cli/scripts/release-publisher.ts`      |    96 | (stays) personal CLI: workstation, infra, release       |
| `packages/personal-cli/scripts/release-terminal.ts`       |    84 | (stays) personal CLI: workstation, infra, release       |
| `packages/personal-cli/scripts/release-trust.ts`          |   122 | (stays) personal CLI: workstation, infra, release       |
| `packages/personal-cli/scripts/release-userpass.ts`       |    94 | (stays) personal CLI: workstation, infra, release       |
| `packages/personal-cli/scripts/release.ts`                |   193 | (stays) personal CLI: workstation, infra, release       |
| `packages/personal-cli/scripts/smoke.ts`                  |    25 | (stays) personal CLI: workstation, infra, release       |
| `packages/personal-cli/src/agent-guide.ts`                |    99 | (stays) personal CLI: workstation, infra, release       |
| `packages/personal-cli/src/source-operations.ts`          |   154 | (stays) personal CLI: workstation, infra, release       |
| `packages/personal-cli/src/workstation.ts`                |   121 | (stays) personal CLI: workstation, infra, release       |
| `packages/personal-cli/tests/release-auth.test.ts`        |   145 | (stays) personal CLI: workstation, infra, release       |
| `packages/personal-cli/tests/release-propagation.test.ts` |    78 | (stays) personal CLI: workstation, infra, release       |
| `packages/personal-cli/tests/release-registry.test.ts`    |    21 | (stays) personal CLI: workstation, infra, release       |
| `packages/personal-cli/tests/release-terminal.test.ts`    |    79 | (stays) personal CLI: workstation, infra, release       |
| `packages/personal-cli/tests/release.test.ts`             |   145 | (stays) personal CLI: workstation, infra, release       |
| `packages/personal-cli/tests/ui.test.ts`                  |   228 | (stays) personal CLI: workstation, infra, release       |
| `packages/personal-cli/tsconfig.json`                     |     5 | (stays) personal CLI: workstation, infra, release       |
| `packages/workstation/cli/commands/net-cmds.ts`           |   194 | (stays) reads fleet.json through the core API           |
| `packages/workstation/cli/lib/net/check.ts`               |    57 | (stays) reads fleet.json through the core API           |
| `packages/workstation/cli/lib/net/fix.ts`                 |   189 | (stays) reads fleet.json through the core API           |
| `packages/workstation/cli/lib/net/history.ts`             |   100 | (stays) reads fleet.json through the core API           |
| `packages/workstation/cli/lib/net/host-checks.ts`         |   340 | (stays) reads fleet.json through the core API           |
| `packages/workstation/cli/lib/net/inventory.ts`           |   101 | (stays) reads fleet.json through the core API           |
| `packages/workstation/cli/lib/net/local-checks.ts`        |   126 | (stays) reads fleet.json through the core API           |
| `packages/workstation/cli/lib/net/make-check.ts`          |    41 | (stays) reads fleet.json through the core API           |
| `packages/workstation/cli/lib/net/net.test.ts`            |   217 | (stays) reads fleet.json through the core API           |
| `packages/workstation/cli/lib/net/run.ts`                 |    66 | (stays) reads fleet.json through the core API           |
| `packages/workstation/cli/lib/net/ssh-config.ts`          |    62 | (stays) reads fleet.json through the core API           |
| `packages/workstation/cli/lib/net/t3.ts`                  |    40 | (stays) reads fleet.json through the core API           |
| `packages/workstation/cli/lib/net/tailscale.ts`           |   108 | (stays) reads fleet.json through the core API           |
| `packages/workstation/cli/lib/net/vscode.ts`              |    68 | (stays) reads fleet.json through the core API           |
| `scripts/dev/README.md`                                   |   389 | (stays) fleet sections move to dev-fleet docs           |
| `scripts/dev/bootstrap.ps1`                               |    51 | (stays) not used by fleet nodes                         |
| `scripts/dev/docker-desktop.sh`                           |    34 | (stays) not used by fleet nodes                         |
| `scripts/dev/native-aws.ts`                               |    87 | (stays) not used by fleet nodes                         |
| `scripts/dev/project-action.sh`                           |    40 | (stays) fleet sections move to dev-fleet docs           |
| `scripts/llms-cloud.template.md`                          |   746 | (stays) rewritten to point at dev-fleet                 |
| `scripts/llms-local.template.md`                          |    95 | (stays) rewritten to point at dev-fleet                 |
| `scripts/llms-txt.template.md`                            |    33 | (stays) rewritten to point at dev-fleet                 |
| `scripts/llms-txt.ts`                                     |   608 | (stays) rewritten to point at dev-fleet                 |
| `scripts/project-action.test.ts`                          |    82 | (stays)                                                 |
| `scripts/single-cli.test.ts`                              |    67 | (stays)                                                 |
