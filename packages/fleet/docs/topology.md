# Fleet topology: one manager, many workers

The fleet has exactly two roles, declared in
[`definition.json`](../definition.json) (version 3) and validated by
[`src/definition.ts`](../src/definition.ts):

| Role        | How many    | Machine                               | Holds state | Runs                                                                                     |
| ----------- | ----------- | ------------------------------------- | ----------- | ---------------------------------------------------------------------------------------- |
| **manager** | exactly one | the human's macOS machine (`manager`) | yes         | `fleet-sync`, the T3 desktop that links to every worker, and **every singleton service** |
| **workers** | any         | Linux boxes (`workers`, Ubuntu 26.04) | no          | the T3 desktop app (UI plus server), agent tools, the Beszel agent; clients only         |

## Manager

- A singleton. All control happens from it, by the human: `personal fleet-sync`
  converges the manager **locally** first, then each worker over SSH.
  `fleet-sync` refuses to run anywhere else (`manager:identity`,
  `FLEET_NOT_MANAGER`).
- It hosts every singleton service. Today that is the CLI proxy
  (`services.proxy`, [`packages/cliproxy-fleet`](../../cliproxy-fleet/README.md))
  and the Beszel hub (`services.monitoring`,
  [`packages/workstation/monitoring`](../../workstation/monitoring/README.md)).
  A new singleton service is declared under `services` and placed on the
  manager; it never names a host.
- Workers depend on it, so it never sleeps on AC power
  (`neverSleepOnPower`, checked as `manager:power`, applied once with
  `ansible-playbook -K packages/workstation/macos/manager.yml`). While the
  manager is asleep, closed or offline, workers have no CLI proxy and no
  dashboard; nothing fails over, because a singleton never runs twice.
- Its state (proxy OAuth/runtime state, the hub database) is backed up off the
  machine as each service documents, so a replacement manager restores it.

## Workers

- Stateless cattle: turn one off, re-image it or add another at will. A worker
  is declared in `workers`, enrolled once (SSH trust, sudo, its own Vault
  token), and then fully rebuilt by `fleet-sync` from Git and Vault.
- Workers never host a singleton service. The proxy reports any local install
  on a worker as a duplicate owner, and the hub refuses to install anywhere but
  the manager.
- Anything on a worker is disposable: T3 sessions and worktrees, caches,
  checkouts. Durable work lives in Git remotes; credentials come from Vault.
- The first declared worker is the rollout canary: a failed canary stops
  promotion to the other workers.

## Changing the topology

- **Add or replace a worker:** add it to `workers`, enroll it with
  `fleet-sync`, done. Remove it by deleting the entry.
- **Replace the manager:** edit `manager`, then move each singleton service with
  its documented fence-and-restore runbook (never two copies at once):
  [CLI proxy](../../cliproxy-fleet/docs/migration.md),
  [Beszel hub](../../workstation/monitoring/README.md).
