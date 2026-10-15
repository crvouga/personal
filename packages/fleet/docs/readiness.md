# Bring-up readiness — 2026-10-14

**Not ready for an unattended production rollout.** The installer builds, but
the production settings and supporting services below still need completion.
The planned rollout is **CI runners converted from existing Windows installations**. The repository allowlist is in [the central GitHub config](../settings/github.json). The other role notes below are dependency context; no target hardware was contacted or erased.

## Windows-to-CI plan

- The result is a NixOS/Linux GitHub Actions runner. Windows and the entire
  internal disk are erased after the installer boots. Back up the machine and
  save its BitLocker recovery key first.
- Use `fleet-installer-windows-x64.exe` from the published release; choose
  **Turn THIS computer into a node**, then **CI**. The wizard needs no Git Bash,
  Python or Nix installation. Windows downloads are unsigned.
- Before conversion: wired Ethernet, AC power, x86_64 UEFI/GPT, Secure Boot off,
  one unambiguous internal disk, enough shrinkable space on `C:` for the image
  and staging partition, and image size plus 2 GiB of RAM. The installer checks
  these with actual sizes; the source Windows machine has not been probed yet.
- The enrolled conversion path supplies the shared CI age key before wiping.
  Do not select `--no-enroll`: a fresh unrelated key cannot decrypt the runner
  App credential.
- The existing [Windows guide](windows.md) covers preflight, the one-time boot,
  undo and recovery. Real Windows firmware/raw-partition boot remains untested;
  qualify one backed-up spare before converting further machines.

### Project compatibility still needs qualification

The allowed repository was checked read-only on GitHub: it is private and has
no registered runners. Its current `check-pr.yml` and `check-nightly.yml` jobs
use `ubuntu-24.04`; its setup uses mise, and its browser action downloads Chrome
assuming Ubuntu libraries are already installed. There is no root `flake.nix`.
These jobs will keep using hosted Ubuntu after a node registers. Do not replace
`runs-on` alone: first provide the project's NixOS-compatible toolchain/browser
libraries (see [project onboarding](onboard-project.md)), qualify a smoke job
using `[self-hosted, nixos, ci]`, then move eligible trusted jobs with bounded
parallelism and the hosted path kept available. No project workflow was changed
in this readiness audit.

### Configuration ownership

| Data                                                                 | Authoritative location                                                                            |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Bootstrap GitHub scope, App/installation IDs and repository fallback | `settings/github.json`, consumed by Nix, setup and health checks                                  |
| Runtime repositories, labels, capacity, pause/cordon settings        | Existing fleet API/Postgres settings (`role:ci`); nodes cache the last accepted settings          |
| Enrollment keys and API credentials                                  | Existing vault OpenTofu root and role-encrypted secrets; never plaintext JSON or application code |
| Firmware, disk, CPU/RAM and hostname                                 | Probed from the machine; no per-node hardcoded files                                              |

The JSON fallback lets registration keep working when the API is unavailable.
It is the only committed location for the chosen repository name. Do not seed a
second repository-specific constant into scripts or workflows.

## Evidence and remaining gates

| Gate                                         | Observed state                                                                                                                                                                                                             | Required before relying on it                                                                                                                                                                                           |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Linux role closures, ISO and NixOS VM checks | The [last full main build](https://github.com/crvouga/workspace/actions/runs/38659022284/job/116175761453) passed, including `nix flake check` and the five role builds.                                                   | Run the full workflow again for the final configuration. This Mac has no Linux Nix builder.                                                                                                                             |
| Wizard builds                                | All five platforms passed tests, Chromium click-through, packaging and self-test in that same run.                                                                                                                         | Exercise the chosen install path on a spare machine. Windows firmware/raw-partition boot remains unqualified on hardware.                                                                                               |
| Installer downloads                          | Publication failed with HTTP 422 because the ISO exceeded GitHub's [2 GiB per-asset limit](https://docs.github.com/en/repositories/releasing-projects-on-github/about-releases). No public installer release is available. | Merge the multipart publication fix and require a successful **publish** job. A green Fleet gate for an unrelated change can skip every build.                                                                          |
| CI runners                                   | `settings/github.json` now contains the confirmed private-repository allowlist and repository registration scope. App/installation IDs are still TODO and the encrypted App key is absent.                                 | Owner must complete `just setup`, which reads that central JSON allowlist. Do not use this public workspace as a runner target.                                                                                         |
| Role keys / enrollment                       | Distinct role keys were generated into the ignored vault input and matching public recipients are in `.sops.yaml`. Live Vault still lacks the enrollment policy/JWT role.                                                  | Preserve the generated ignored input, carry the same complete map into the managed CI vault inputs, and apply a reviewed vault plan. Confirm each needed `secret/fleet/<role>` document exists without printing it.     |
| Fleet API                                    | `fleet.chrisvouga.dev` does not resolve; its image is unavailable to anonymous pulls. Live Vault lacks the three API settings.                                                                                             | Complete foundation, image publication, vault and fleet-root deployment through OpenTofu; require DNS, TLS, `/health` and authenticated health checks to pass.                                                          |
| Initial database schema                      | [CI deployment](https://github.com/crvouga/workspace/actions/runs/38676867317) fails planning Atlas: `schema "fleet" was not found`.                                                                                       | Bootstrap only the empty schema through a reviewed targeted foundation plan, then review/apply the full foundation plan (details below).                                                                                |
| Automatic updates                            | Shared binary-cache URL/key are null; the cache role's secret file is null. GitHub lacks `FLEET_CACHE_URL`, `FLEET_CACHE_NAME`, `FLEET_ATTIC_TOKEN`.                                                                       | Bring up Attic with its own encrypted secret, commit its actual URL/public key, and manage workflow values through OpenTofu. Require a successful merge-group cache push. Without this, nodes wait instead of updating. |
| Merge protections                            | Live `main` requires `Required`, but lacks the declared `Fleet` check and merge queue.                                                                                                                                     | Apply the reviewed foundation ruleset change after its cache prerequisites are available.                                                                                                                               |
| Web / cache / netboot                        | Web serves only the placeholder; cache service is disabled; netboot flags cannot finish an install.                                                                                                                        | Supply real web apps and role secrets where needed. Use the ISO for installation, including the first netboot server.                                                                                                   |
| Devbox access                                | Installer requires a valid SSH public key. Shared emergency SSH keys are empty.                                                                                                                                            | Have the intended dev public key available before wiping; its private half stays on the connecting computer. Empty emergency keys are valid.                                                                            |

`bun run health` was run against production: **220 pass, 14 warn, 8 fail,
9 skip**. The fleet-related failures are listed above. Missing credentials and
skipped checks are not acceptance evidence.

## Order of work before installation

1. The CI role, Windows conversion path and private repository have been chosen.
   Complete owner setup from the package directory with `just setup`; it reads
   `settings/github.json` rather than inserting repository names into code.
   Commit only public recipients, encrypted role files and role settings.
   Preserve the generated private role keys in the ignored vault input and an
   appropriate secure backup; never paste them into a command or commit them.
   Before the next CI vault apply, include the same complete `fleet_age_keys`
   map in the foundation root's `vault_inputs` (which owns `TOFU_VAULT_INPUTS`).
   The ignored local file is not uploaded by a merge; omitting the keys from CI
   inputs would make the protected role documents fail their next plan.
2. Bootstrap the missing database schema using the foundation procedure below.
   Complete the full foundation and vault plans, publish the API image, then
   apply the fleet root. These are cloud resources, exclusively managed by
   OpenTofu. Import any resource that already exists before adoption.
3. Configure the first cache node's encrypted `attic-env` and its intended
   reachable address, then build/publish that configuration. Bootstrap it from
   the ISO. Add the resulting cache URL and public key to shared settings;
   configure the CI cache inputs through OpenTofu. Verify substitution and the
   merge-group push before depending on automatic updates or the merge queue.
4. Merge the final role settings and installer fix through the required checks.
   Inspect the actual **check**, **wizard**, **publish** and, for a merge group,
   **cache** results. Confirm the release contains `fleet-node.sh`, all five
   wizard downloads, the `.parts.json`, `.sha256` and every listed image part.
   Clients assemble one verified local ISO automatically; do not flash a part.
5. Run `bun run --filter @pkgs/fleet check` and `bun run health`. Resolve the
   relevant failures and skipped checks, then qualify one spare node before
   installing the rest.

### First foundation schema plan

Atlas inspects the database while planning, before `depends_on` can create the
empty schema. On a properly initialized foundation root with its encrypted
backend and provider inputs, run these commands **from the repository root**:

```sh
bun run infra plan -parallelism=1 -target=postgresql_schema.fleet -out=fleet-schema.plan
bun run infra show fleet-schema.plan
# Only after reviewing the saved plan:
bun run infra apply -parallelism=1 fleet-schema.plan

bun run infra plan -parallelism=1 -out=foundation.plan
bun run infra show foundation.plan
# Only after reviewing the full plan and the Atlas diff:
bun run infra apply -parallelism=1 foundation.plan
```

The targeted plan is a one-time bootstrap of the empty `fleet` schema. It does
not replace the full plan. Atlas must retain `search_path=fleet`; reject any
diff affecting another project's schema. Existing resources must be imported
before adoption. Keep saved plans private and uncommitted. No production plan
or apply was run during this readiness audit.

## At the machines tomorrow

Use wired Ethernet and x86_64 UEFI hardware; disable Secure Boot and set power-on
after AC loss. Keep backups of anything on the internal disk. The installer
requires one unambiguous internal disk. Set the lasting boot order to network,
then the internal disk; use the firmware's one-time USB menu for the first install.

Run `sudo bash fleet-node.sh doctor <role> --json` before conversion. An agent
must show the exact disk and obtain explicit human wipe approval before using
`--yes`; a readiness request does not approve erasing any disk.

A plain USB install generates its own age key. A role with encrypted shared
secrets needs the matching canonical `<role>.age` on a separate `FLEET-KEY`
volume, or the enrolled conversion path. An empty key volume creates a new key;
it does not recover the key used to encrypt the committed secrets. A USB node
also needs dashboard approval because it has no API role token. A devbox can
read its public SSH key from `devbox.pub` on that volume or the console.

After the first boot, require: `fleet-node status` shows the intended role,
revision and no unexplained failed units; the dashboard shows an approved,
online node; CI runner labels/registration match the private allowlist; the
role's actual service works; a reboot preserves access; and a subsequent
Git-managed update succeeds through the cache. Verify host-key fingerprints
from the console when first connecting. Continue with [the checklist](checklist.md)
and [the operations runbook](runbook.md).
