# Developer fleet: one manager (macOS) and stateless workers (Ubuntu)

## Release status

This working-tree implementation is **not yet a completed or published fleet
release**. Do not describe it as having configured Chris’s machines. Required
acceptance checks remain incomplete: multi-target remote/bootstrap fault tests, unattended
paired T3 execution and live private-route acceptance, all five live provider routes, manager boot/scheduling acceptance,
off-host monitoring recovery, and the full Ubuntu drift/fault matrix. Disposable Ubuntu baseline
apply/repeat/reboot and pinned native T3 install/repeat/crash recovery/reboot passed.
The production boot-policy observer also passed inside the rebooted VM. Pinned
Beszel hub installation (including a missing Docker engine), repeat no-op and
reboot passed. Native Beszel agent installation, repeat no-op, crash recovery and
reboot also passed with an intentionally unreachable fixture hub; private metrics
acceptance remains separate. A further full SSH bootstrap test caught a T3 archive verification bug: release-builder UID/GID values are not the designated installation user. The shared installer now verifies local ownership, content, modes and links independently of archive-builder identity. The same test exposed restrictive-umask extraction drift; archive modes are now preserved and staging is verified before promotion. A fresh Ubuntu VM now passes the production strict-SSH source transfer, missing-prerequisite bootstrap, shared tool installation and baseline, then repeats with preserved SSH identity, developer work and managed-file timestamps. This uses a disposable exact test commit, not a published release or live fleet. Multi-target and interruption acceptance remains open. The VM caught and fixed an Ansible piped-stdin
variable-loading failure; runtime variables now use a private temporary file with
cleanup and never enter command arguments. See the
[reproducible VM test instructions](../../workstation/ubuntu/tests/README.md).
Real Beszel 0.21.1 binaries passed authenticated metrics, identity preservation and
supported API backup/restore in an isolated loopback fixture; that is not live fleet evidence. Incomplete
checks return nonzero; they do not advance a successful fleet receipt.

Newest and still unverified against live machines: the macOS convergence path
(`packages/workstation/macos`, launchd Beszel agent, fcntl remote lock), the Linux
always-on service drop-ins, and dashboard evidence inside `fleet-status --workers`.
They pass unit tests and Ansible syntax checks only; treat them as unaccepted
until a disposable-machine run and a live manager run are recorded.

## One command, from the manager

```sh
npx @crvouga/personal fleet-sync
```

`personal fleet-sync` executes the manager-push implementation:

```text
resolve enrolled fleet
→ inspect Tailscale and verified SSH
→ bootstrap missing remote prerequisites
→ apply one approved exact revision
→ establish fresh SSH connections and check readiness
→ report every target, including offline and blocked nodes
```

Bare invocation selects every canonical Linux and macOS node. It does not mean
“this computer,” and the manager is not implicitly a deployment target. Its own
node is targeted only if explicitly declared in Fleet membership. Ubuntu 26.04 is
the accepted worker platform; a node declared `"os": "macOS"` runs the same phases
best effort through `packages/workstation/macos` (see the platform matrix below).
Windows machines stay declared for diagnostics and are never converged.
`--node ID` filters troubleshooting/rollout. `--all` is an explicit spelling of the
default. Neither flag authorizes managing arbitrary Tailscale peers.

Roster-level workspace convergence lives in `personal fleet-repair --repair workspace`, which previews until `--apply --yes`.
The new manager report is version **2**, deliberately replacing the unshipped
local-first fleet-sync version 1 contract.

## Prerequisites and first enrollment

The manager needs Node/npm (Node `^22.13.0 || >=23.5.0`), an OpenSSH client,
a working Tailscale daemon, and Git for approved source preparation. npx cannot
execute without Node/npm. Existing shared setup remains
[`scripts/dev/bootstrap.sh`](../../../scripts/dev/bootstrap.sh); run that tracked
bootstrap on a manager without developer tools, then invoke the same command.
Do not install an unrelated fleet installer. The npm command’s help, catalog and
structured missing-enrollment result require neither Bun nor a checkout.

On first interactive use the command resolves only canonical machines through
existing SSH aliases, tests strict SSH access, and offers one enrollment
confirmation for the verified connections. The apply approval binds a fingerprint
of the selected revision, policy and connection records; changed bindings fail
with `FLEET_PLAN_STALE` before source preparation or remote mutation. It stores private overrides mode 0600. Unknown host keys are never accepted automatically. Compare fingerprints
out of band before enrolling trust. Unreachable machines remain listed; first
reachability requires an existing trusted LAN SSH route or physical setup of
SSH/Tailscale. No software on the manager can bootstrap a disconnected box.

A previously configured manager uses saved connection bindings and its approved
revision. A changed Tailscale device ID is a replacement gate, even if the old
DNS name and SSH alias still resolve. Enrollment never copies host keys,
Tailscale state, provider OAuth, or another machine’s T3 environment.

Remote developer-tool prerequisites are not required: the initial SSH probe uses
POSIX facilities. Approved application sends a Git bundle and the bootstrap
script extracted from that exact commit over verified SSH. It installs missing
Ubuntu bootstrap packages through signed APT, then uses the existing mise and
frozen dependency installer. Bootstrap APT packages currently use the installed
Ubuntu archive configuration; strict dependency closure/snapshot promotion is a
remaining parity gate. The interactive manager flow can request native sudo authorization over a verified SSH terminal after the consolidated apply confirmation. It validates and installs the designated-user sudo policy; passwords are never captured or stored. Missing administrator permission, an unmanaged conflicting sudoers fragment, or unavailable terminal remains action-required. JSON and unattended runs never prompt and require existing noninteractive sudo.

## Policy, ownership and private state

- `packages/fleet/definition.json` and `definition.schema.json`: portable machine
  IDs, aliases, OS, singleton roles and Ubuntu release policy.
- Private manager overrides: `--config PATH`, `PERSONAL_FLEET_CONFIG`, or
  `~/.config/personal/fleet.json`, using the existing roster schema. Preserve
  workspace/runtime paths, capabilities and explicit `tailscaleId` bindings.
- Workstation network consumers derive their inventory from Fleet. The old file
  is retained only as `packages/fleet/migrations/workstation-network-v1.json` for
  lossless identity-path migration; conflicts fail rather than silently winning.
- Manager approval: `~/.local/share/personal/fleet/manager/enrollment.json`.
  Manager deployment lock: adjacent `sync.lock` directory.
- Remote source: `~/.local/share/personal/fleet/revisions/FULL_SHA`.
  Remote lock file: `~/.local/share/personal/fleet/remote-operation.lock`, held
  with `flock` on Linux and the same descriptor through Python `fcntl` on macOS.
  Never repurpose a development checkout or reset dirty worktrees.
- Workstation owns `ubuntu/`, `macos/` and `monitoring/`; mise manifests, locks and
  `scripts/dev` own developer tools. CLIProxy deployment/auth/recovery stays with
  `packages/cliproxy-fleet`. Cloud resources, DNS, Vault policy and tailnet access
  policy stay with OpenTofu and are not modified by this command.

The repository is public. Existing portable host metadata was retained during
migration; do not publish device IDs, private keys, manager-specific secrets,
credentials, backups or runtime databases. Intentional persistent policy changes
must be reviewed in Git. Emergency service restarts do not authorize permanent
untracked configuration edits.

## Preview, approval and results

```sh
personal fleet-sync --dry-run --json
personal fleet-sync --revision FULL_40_CHARACTER_SHA --dry-run --json
personal fleet-sync --revision FULL_40_CHARACTER_SHA --non-interactive --json
```

Preview can query Tailscale and establish read-only SSH sessions. It never enrolls,
authenticates to a provider, installs, creates pairing material, schedules work or
writes configuration. JSON/noninteractive modes never prompt or open a browser.
`fleet-sync` applies on invocation with no confirmation prompt; use `--dry-run`
to preview. `--apply --yes` is still accepted for existing scripts. Initial
trust/enrollment of new connections still asks separately.

Select one full lowercase commit SHA. Approval is saved on the manager and
retained throughout the run. New package versions do not silently replace saved
approval. Promote a reviewed release with the explicit `--revision SHA` invocation.
Use `npx @crvouga/personal@VERSION fleet-sync ...` for automation; unversioned npx
is convenience, not a reproducibility guarantee. Dirty review artifacts have no
automatically approved source SHA.

Version 2 JSON contains `execution: manager-push`, desired revision, per-node
reachability, applied revision (null when not verified), checks, durations,
candidate count and the private dashboard URL when the enrolled hub resolves.
An absent applied revision is not “unchanged.” Every required skip/failure keeps
readiness incomplete. Exit 0 means the requested read-only inspection or required
checks passed; 1 means incomplete/action-required/failed; 2 means invalid usage or
refused configuration. JSON is one document on stdout, with no child process logs.

These are distinct facts: configuration applied; local services healthy; fresh
manager connection verified; authenticated IDE/T3 tool execution verified.
Neither an HTTP 200 nor a successful installer establishes the last fact.

## Machine policy by platform

Every machine-level setting is declared in Ansible using only `ansible.builtin`
modules, applied by `node-converge` after source bootstrap, and then measured
independently. Bespoke TypeScript remains only where a native CLI or API has no
declarative owner: T3 service lifecycle, Beszel enrollment tokens, provider
verification and the CLIProxy singleton.

| Policy                      | Workers (Ubuntu 26.04, stateless)                                                                                                                                                                                                                                                                                                                                                                                                                   | Manager (macOS, singleton)                                                                                                                                                                                |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Never sleep                 | systemd sleep targets masked; logind lid/idle policy; GNOME power plugin set to `nothing`                                                                                                                                                                                                                                                                                                                                                           | never sleeps on AC power (`pmset -c sleep 0`, `macos/manager.yml`, verified as `manager:power`); battery sleep is left to the human                                                                       |
| No automatic logout or lock | GNOME `lock-enabled false`, `idle-delay 0`; designated-user lingering                                                                                                                                                                                                                                                                                                                                                                               | not managed (the human uses it)                                                                                                                                                                           |
| Always-on services          | drop-ins `Restart=always`, `StartLimitIntervalSec=0` for ssh, tailscaled, docker, beszel-agent                                                                                                                                                                                                                                                                                                                                                      | singleton services under launchd and Docker Desktop (see the last row)                                                                                                                                    |
| T3 health and connection    | `fleet-sync` and `fleet-status --workers` require `worker:t3-health` (local API answers), `t3:manager-endpoint` (manager HTTPS over Tailscale) and `t3:paired-access` (manager T3 link reachable)                                                                                                                                                                                                                                                   | the human's T3 desktop holds the links to every worker (`t3:paired-access`)                                                                                                                               |
| Memory safety               | `systemd-oomd` (swap 90%, pressure 60%); `user.slice` `MemoryMax=90%`; each `t3code-*.scope` agent `MemoryMax=30%`, `OOMPolicy=continue`; swap file when none                                                                                                                                                                                                                                                                                       | not managed                                                                                                                                                                                               |
| Disk safety                 | `personal-fleet-disk-guard` kills only the top user-cgroup writer below 3 GiB free, never deletes files; journal 1G; `/tmp` 25% of RAM, aged 2d hourly; Docker log rotation                                                                                                                                                                                                                                                                         | not managed                                                                                                                                                                                               |
| Tailscale                   | pinned APT package, `tailscaled` enabled, native login required                                                                                                                                                                                                                                                                                                                                                                                     | Tailscale app, human login                                                                                                                                                                                |
| Dashboard agent             | pinned native binary, hardened `beszel-agent` systemd unit as user `beszel`                                                                                                                                                                                                                                                                                                                                                                         | not installed                                                                                                                                                                                             |
| Credential renewal          | user timer `personal-worker-auth` renews the node's own Vault token and GitHub login every 10min                                                                                                                                                                                                                                                                                                                                                    | the human's own Vault and GitHub sessions                                                                                                                                                                 |
| Noninteractive sudo         | validated `/etc/sudoers.d/personal-fleet-USER`                                                                                                                                                                                                                                                                                                                                                                                                      | never; the human runs `manager.yml` once with `-K`                                                                                                                                                        |
| T3 worker app               | pinned desktop `.deb` is the only T3 process (UI plus embedded server); GDM auto-login, user unit `t3code-desktop.service` bound to the graphical session with `Restart=always`; `personal-worker-recovery` checks every minute, starts a stopped app and restarts one whose local API missed three checks; administrator policy. A still-running headless `t3code.service` reports `T3_DESKTOP_MIGRATION_REQUIRED` (stopping it ends active turns) | not a worker                                                                                                                                                                                              |
| T3 providers                | the same managed instances (`workstation/agents/t3.json`) through locked T3 administrator policy                                                                                                                                                                                                                                                                                                                                                    | reconciled into the human's T3 settings by `fleet-sync` (`t3:providers`) with the ownership-safe `t3-apply` engine, so every T3 offers the identical set; unrelated and unmanaged instances are preserved |
| Singleton services          | never; clients of the manager's services only                                                                                                                                                                                                                                                                                                                                                                                                       | every singleton runs here: CLI proxy (`packages/cliproxy-fleet`), Beszel hub (`workstation/monitoring`)                                                                                                   |

Credential sync is deliberately indirect: no secret is copied between machines.
OpenTofu issues each enrolled worker its own renewable periodic token
(`vault.tokens` entries `fleet-worker-<node>`, policy `personal-read`, sunk into
`secret/personal/prd` as `FLEET_WORKER_TOKEN_<NODE>`). `personal fleet-sync`
delivers each node's token automatically over SSH stdin (never as an argument)
whenever that node has no working Vault session. Interactive runs first log the
manager in (`vault login -method=userpass`, password typed on your terminal)
and fall back to the same password login on a node whose token is not issued.
Without either, the node reports `VAULT_LOGIN_REQUIRED` and its T3 proxy
providers stay unavailable. The manual equivalent of the automatic delivery:

```sh
vault kv get -field=FLEET_WORKER_TOKEN_CHRIS_VOUGA_MS_A2 secret/personal/prd \
  | ssh chris-vouga-ms-a2 'vault login -address=https://vault.chrisvouga.dev -no-print -'
```

From then on the node's `personal-worker-auth` timer renews that token and its
GitHub login, and renders provider configuration from Vault through Workstation.

## Ubuntu and remote-work safety

The declared common baseline is Ubuntu **26.04 LTS**, amd64/arm64. Other releases
receive `UBUNTU_BASELINE_MISMATCH`; there is no automatic release upgrade or
package downgrade. Workstation audits release, packages, service state and dpkg
consistency, declares snapshot sources for managed transactions, and pins its
selected APT packages. Unrelated applications and package sources are preserved.

Power policy masks sleep/hibernate targets and declares logind sleep/lid defaults.
GNOME lock/idle changes apply to the designated user only. Effective running
session/logind behavior still needs a maintenance/reboot acceptance check; writing
a file does not prove logout/reboot survival. The sudoers fragment is validated
with visudo before installation; this user and its agents can administer the
machine. SSH authentication remains enabled.

SSH forwarding changes validate the complete configuration before reload and
restore the previous fragment on validation failure. Existing listeners,
authentication and firewall rules are preserved. Existing socket activation is preserved for forwarding-only changes; listener
migrations and unmanaged fragments require review. The manager makes a **new**
strict SSH connection after apply. Private-listener/firewall acceptance and
failure-after-reload recovery still require disposable integration testing.

The manager is the only configuration coordinator. No per-node pull timer is
installed. Manager schedule controls use the existing platform adapter:

```sh
personal fleet-sync --schedule status --json
personal fleet-sync --schedule enable --revision FULL_40_CHARACTER_SHA --apply --yes
personal fleet-sync --schedule pause --apply --yes
personal fleet-sync --schedule resume --revision FULL_40_CHARACTER_SHA --apply --yes
personal fleet-sync --schedule disable --apply --yes
```

These are manager setup/maintenance operations, not per-node commands. Enable
and resume install the exact published CLI version in the managed manager
runtime and schedule the same whole-fleet command every 30 minutes at the explicit
approved SHA. They refuse dirty artifacts. Pause/disable remove only the manager
schedule. Re-enable with the new approved SHA when promoting a release; the timer
does not resolve `latest`. Linux user scheduling requires lingering; macOS uses
the existing LaunchAgent and requires a user session. Unattended manager boot
acceptance and log-retention configuration remain gates. No node pull scheduler
is installed or necessary.

Routine sync never reboots a box or deliberately kills IDE/T3 work. Explicit
maintenance reboot/reconnect orchestration remains an acceptance gate. Kernel,
driver, firmware, hardware and power failures are outside any “never freezes”
promise. Inspect disk/inodes, swap/memory pressure, `systemctl --failed`, and prior
boot journal evidence locally; sanitize it before sharing. Do not enable automatic
reboot-on-pressure or kill active work to obtain a green report.

T3 0.1.7's supported administrator policy at `/etc/t3code/policy.json`
disables independent updates and declares the existing managed Codex instance
plus an OpenCode instance for all five gateway models. Workstation reuses the
existing `agents/t3.json` renderer; it does not edit the live settings database.
Native `t3 policy check` validates before installation, and `t3 policy show`
compares staged policy with the running server. `T3_POLICY_RESTART_PENDING`
requires maintenance; no automatic restart is used to hide that distinction.
Unrelated administrator policy is a conflict requiring a reviewed merge.

## Central provider access

The `https://cli-proxy.chrisvouga.dev` gateway is a singleton service, so it
runs on the manager (`definition.json.services.proxy`). Workers consume that
gateway; no worker gets a separate OAuth-owning proxy. Keep the existing
key/endpoint contract, encrypted recovery and runtime authentication. Moving it
requires fencing the old host before restoring state
([migration](../../cliproxy-fleet/docs/migration.md)). Fleet never copies identities.

Workstation applies Codex, Claude, Gemini and OpenCode proxy profiles. Claude’s
explicit model is `claude-sonnet-4-6`. Pinned Gemini CLI 0.66.0 supports native
`gateway` authentication with `GOOGLE_GEMINI_BASE_URL` and a runtime Vault key;
its request protocol is Gemini `generateContent`, not OpenAI Responses. Grok
(`grok-4.7`) and Muse (`muse-wonder-1.0`) are declared OpenCode harness routes,
not invented native CLIs. Exact models live in `agents/registry.json` and must
be present in the authenticated gateway catalog; no automatic model substitution.

Apply runs bounded authenticated inference plus completed Responses streaming
and a safe echo-tool round trip for each declared provider through the supported
harness route. The echo probe cannot execute shell commands or access files.
These consume small model requests; errors are redacted and do not silently retry
OAuth. Native CLI compatibility and paired T3 execution remain separate gates.
Live five-provider acceptance is still incomplete. `/models` is not proof that five native clients are authenticated.
Do not disguise unsupported native clients with wrapper executables. Missing or
expired unattended Vault authorization remains an explicit dependency; a cached
interactive token is not a supported long-term credential lifecycle.

## Beszel: stock dashboard and history

Beszel supersedes the unshipped Netdata proposal. No Netdata was deployed by this
work. Preserve any independently installed Netdata data and prepare an explicit
migration before removal. The hub is a singleton service, so it runs on the
manager (`definition.json.services.monitoring`) and agents on every worker report
to `https://<manager MagicDNS>:8443`. The manager's uptime is the dashboard's
uptime.

Workstation pins Beszel **0.21.1**: multiarchitecture hub image digest and native
amd64/arm64 archive SHA-256 values are in `monitoring/lock.json`. Compose binds
only loopback port 8090 with persistent `~/Library/Application Support/personal-beszel` on the manager (Docker Desktop). Tailscale Serve
provides private HTTPS port 8443, preserving other handlers and refusing conflicts.
Docker Desktop must be running on the manager (`BESZEL_DOCKER_DESKTOP_REQUIRED`). Existing different hub images require backup and
explicit maintenance instead of an automatic restart during routine sync.

The native Linux agent runs as `beszel`, with persistent `/var/lib/beszel-agent`,
unconditional restart, bounded resource limits and no incoming listener. On macOS
the same pinned binary runs as a root launchd daemon with `KeepAlive`; it is less
sandboxed than the systemd unit and is best effort. It uses authenticated outbound
WebSockets. The selected systemd services are SSH, Tailscale, T3 and manager
sync where present. Journal access and Docker socket access are disabled by
default. Do not expose all host journals or Docker root access merely to get a
collector green. Unavailable service/sensor/GPU/disk-health data is unavailable,
not healthy.

OpenTofu generates the enrollment credential: `BESZEL_FLEET_AUTH` in
`secret/personal/prd` is the password of the normal (non-superuser) Beszel account
`fleet-manager@chrisvouga.dev`. After the vault root has applied, create that
account once on the hub with the generated password (hub superuser → Users →
New record, or the PocketBase API) and grant it the fleet systems.
The hub runs with `SHARE_ALL_SYSTEMS=true`, so systems that account registers are
visible to every hub login. A legacy JSON
`{identity, password}` value is still accepted. No Vault policy is seeded by
setup; never pass the credential on command arguments. Only per-node agent
tokens cross SSH stdin. Supported systems/fingerprints APIs reuse canonical node
records, preserve fingerprints, and reject duplicate names or conflicting hosts.
The account credential remains on the manager. Revoke/rotate it in Beszel and
the existing secret owner; do not erase agent state to force reenrollment.

`fleet-sync --dry-run --json` and `fleet-status --workers --json` report
`dashboardUrl` when the enrolled parent can be resolved. Open that private URL in
a tailnet-connected browser for CPU, memory, disk, network, temperature and
service history of every node. `fleet-status --workers` also verifies the hub
answers privately and that each canonical node is registered, connected and
reporting fresh samples; a manager without a Vault session reports
`beszel:access` as skipped, never as healthy. Fleet reports deployment/readiness;
Beszel reports resource history. Hub outages do not stop SSH/T3 or erase last
working machine configuration, but monitoring stays incomplete.

Supported verification checks authenticated hub version, one canonical record,
connection state, and a one-minute sample received within 180 seconds (with bounded
clock-skew tolerance). Immediately after installation the next sample can be
pending; rerun after its collection interval. Do not count local HTTP health as
historical metrics acceptance.

In the hub UI, configure network monitors with explicit origins: hub→SSH ports,
manager-capable agent→private T3 endpoint, and selected agent→management host
and gateway TCP 443. An unauthenticated gateway `/v1/models` returns 401 and is
not a suitable unauthenticated HTTP success probe. Do not create all-to-all probes.
Network monitor UI configuration, alert thresholds and backup settings are not
reconciled by this implementation. Set sustained CPU/memory pressure, low disk,
offline and available temperature alerts in the stock UI; configure no external
notification destination without authorization. Service failure alert behavior
must be tested for the pinned release before promising it.

Upstream owns tiered metric retention. No arbitrary retention knob or hard disk
quota is invented here. Compose logs are bounded, but data-volume capacity/backup
retention requires an explicit operator setting and acceptance. Use PocketBase’s
supported backup UI/API and approved existing storage, preserving hub identity,
registrations, alert settings and history. Off-host encrypted backup/restore
integration remains an operational gate. The pinned upstream fixture has now
created a backup using `POST /api/backups`, restored it using
`POST /api/backups/{key}/restore`, and verified the original node ID and agent
fingerprint survived while a post-backup record disappeared. This is disposable
API evidence, not an off-host recovery test. See the
[monitoring runbook](../../workstation/monitoring/README.md) for the stock UI procedure. Never edit the live database.

Official feature references: [native agent](https://beszel.dev/guide/agent-installation),
[systemd](https://beszel.dev/guide/systemd), [network monitors](https://beszel.dev/guide/network-monitors),
[REST API](https://beszel.dev/guide/rest-api), and [pinned release](https://github.com/henrygd/beszel/releases/tag/v0.21.1).

## Failure, retry and recovery

| Stable outcome                                                                           | Read-only diagnosis and source-owned remedy                                                                                                                                                                              |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `FLEET_MANAGER_ENROLLMENT_REQUIRED`                                                      | Inspect canonical membership and private overrides; rerun interactive enrollment. Preserve conflicting files for review.                                                                                                 |
| `TAILSCALE_ENROLLMENT_REQUIRED` / `TAILSCALE_DEVICE_REPLACED`                            | Verify intended device ID and host fingerprint. Update reviewed private binding only after genuine enrollment.                                                                                                           |
| `TAILSCALE_NODE_OFFLINE` / `TAILSCALE_NODE_MISSING`                                      | Restore power/connectivity or the trusted LAN route; next manager run catches up.                                                                                                                                        |
| `ssh:host-key` / `ssh:auth`                                                              | Verify fingerprint or designated user/public key. Never disable host-key checking or copy another host’s keys.                                                                                                           |
| `SUDO_AUTHORIZATION_REQUIRED`                                                            | Supply initial local privilege through an authorized enrollment step; do not disable SSH authentication.                                                                                                                 |
| `REMOTE_BOOTSTRAP_INCOMPLETE`                                                            | Inspect the named phase, dpkg state, free disk, DNS and package access. Wait for a real package transaction; never delete locks.                                                                                         |
| `TOOLCHAIN_MISE_FAILED` / `TOOLCHAIN_T3_FAILED` / `TOOLCHAIN_FROZEN_DEPENDENCIES_FAILED` | Inspect the nonsecret `toolchain-status.json` under remote Fleet state, available disk and signed artifact/registry access. Rerun the approved revision; never replace pins or bypass checksum/frozen-lock verification. |
| `TOOLCHAIN_CONFIG_CONFLICT` / `TOOLCHAIN_PATH_CONFIGURATION_FAILED`                      | Inspect managed mise ownership and declared shell/PATH settings. Preserve unrelated configuration and resolve the source-owned migration before retrying.                                                                |
| `FLEET_REMOTE_LOCKED`                                                                    | A remote configuration operation still owns the kernel lock. Inspect its PID and state; wait for completion instead of deleting locks or launching another installer.                                                    |
| `FLEET_PROMOTION_BLOCKED`                                                                | Resolve discovery/canary failure before promoting the same revision to remaining nodes.                                                                                                                                  |
| `BESZEL_DUPLICATE_NODE` / host conflict                                                  | Inspect hub registrations. Preserve history/fingerprint and resolve assignment; do not repeatedly create records.                                                                                                        |
| `BESZEL_METRICS_STALE`                                                                   | Check hub/node clocks, connection, capacity and sampling timestamp.                                                                                                                                                      |
| `BESZEL_ENROLLMENT_INCOMPLETE`                                                           | Check hub reachability, account grant and Vault renewal. Raw responses/tokens are withheld.                                                                                                                              |
| `REQUIRED_ACCEPTANCE_UNVERIFIED`                                                         | Run the missing real acceptance check; a skip must never be changed to pass without evidence.                                                                                                                            |

After interruption rerun the same manager command. Manager locks fail closed
rather than stealing a possibly live operation. Inspect active manager and
remote processes before removing an abandoned manager `sync.lock`. Its private
`owner.json` records PID and start time; node `remote-operation.json` records PID,
node and source revision. `toolchain-status.json` records only the shared installer phase and running/failed/passed status, mode 0600; it contains no raw subprocess output. These are diagnostic hints, never proof that a process
has stopped or that a phase succeeded. Remote flock
lives as long as the process tree holds it: a lost SSH connection is not proof that
APT stopped. No installer deletes APT locks or blindly kills package processes.

To roll configuration back, select the previous approved full SHA in the manager
and review/apply it. Dirty deployment directories are never reset. Configuration
rollback is **not** atomic APT rollback, a distribution downgrade, or a restore of
provider OAuth/application databases. Native identities, T3 conversations, worktrees
and uncommitted repositories must be preserved. Test the promised restore path
before replacing a singleton hub or proxy host.

## Agent and release instructions

Inspect `personal commands --json`, `personal commands --json`, this guide and
`personal fleet-sync --help` first. Use the public manager flow and existing
owners. Do not create a second installer/manager, run per-node pull schedules,
substitute discovered peers, patch `/opt` deployment code, or bypass failed gates.
Keep secrets, pairing URLs, raw environments and whole journals out of reports.

Run affected tests/typechecks/lints, Ansible syntax and disposable Ubuntu integration,
then `bun run llms:sync`, `bun run check:llms`, npm build and anonymous consumer smoke.
Use `packages/personal-cli/releasing.md` for publication. The generated guide is
linked from `https://chrisvouga.dev/llms.txt` through `llms-infra.txt`; its fleet section
is separate from cloud infrastructure. Local generation does not prove deployment.
After an authorized release, fetch public llms.txt, follow the guide link and test
the exact published npm version from a clean consumer.

## Agent triage and tracked acceptance issues

Start read-only on the manager:

```sh
personal fleet-sync --dry-run --json --non-interactive
personal fleet-sync --schedule status --json
```

The version 3 report includes a `diagnostics` array per node with stable `code`
and `checkId`, expected/observed evidence, scope, retryability, action-required
state and the owning package's remedy. Measured remote phase durations survive
transport redaction; checks without a measured phase retain null rather than a
fabricated timing. `scope: unverified` means the origin was
not established; a null check duration is unknown, not zero. Node duration is
measured separately. Preflight failures still list every canonical Ubuntu target
with unknown reachability, rather than fabricating offline results or omitting
nodes. Human output includes manager-level failures as well as per-node checks.

Use the repository’s **Developer fleet failure** issue form for a new defect.
For a bug, record package version, approved source SHA, stable check code, whether
this was preview/apply/maintenance, starting condition and the smallest safe
reproduction. Attach only the redacted CLI document after inspecting it. Never
attach `.fleet.local.json`, private SSH config, complete journals, token files,
pairing links or hub backups. A diagnostic owner points to the existing package;
fix persistent policy there, add a regression case, promote one reviewed commit,
and rerun the same manager flow. Do not resolve a failed gate by editing its
reported status or by an untracked remote shell patch.

Open acceptance issues (these do not imply production machines were fault-tested):

- [#209: multi-target SSH bootstrap and interrupted-run recovery](https://github.com/crvouga/personal/issues/209).
- [#210: private paired T3 and five shared-provider routes](https://github.com/crvouga/personal/issues/210).
- [#211: Beszel native lifecycle, private metrics and off-host recovery](https://github.com/crvouga/personal/issues/211).

Each issue has existing evidence and completion criteria. Close a gate only with
the specified real evidence; mocked transport tests cannot substitute for VM or
separate-client acceptance. Newly found defects should have one focused issue with
a reproduction and stable code, linked to the relevant gate.

Canary promotion gates distinguish configuration failure from external acceptance. A failed configuration blocks promotion; missing pairing or monitoring evidence remains an unsuccessful readiness result but does not prevent independent configuration on other enrolled nodes. Native T3 outcomes that need an operator maintenance window (an active listener outside the managed unit, a different running release, a pending policy restart) are reported as failures but likewise do not block other nodes; routine sync never kills active T3 work to clear them. Neither condition advances a fully verified success receipt.

The managed native T3 service uses a stock Tailscale Serve HTTPS route on port
443 to its loopback port 3773. The manager configures and independently reads
back the route without restarting T3. Existing handlers and Funnel exposure are
conflicts requiring reviewed migration; sync never resets Serve. Serve persistence
is independent of application startup, so temporary VPN loss does not become a
T3 startup dependency. The manager then makes a fresh TLS-verified HTTPS
request to the enrolled device. An HTTP 200 proves endpoint transport only; it
does not establish client compatibility, pairing, or model/tool execution.

Boot-policy verification reads the running logind D-Bus properties, sleep target
masks and designated-user lingering. It requires the managed power files to
predate the current kernel boot before recording boot acceptance. Newly staged
policy reports `UBUNTU_MAINTENANCE_REBOOT_PENDING`; routine convergence never
restarts logind or reboots active development sessions.

Remote bootstrap requires at least 2 GiB free and 50,000 free inodes before source
transfer; Workstation then applies its stricter capacity policy. Capacity failures
never delete repositories or caches. Git bundles are bounded to 512 MiB, and a
verified clean cached revision avoids retransferring repository history.

The current-manager provider preflight returned `PROVIDER_UNATTENDED_CREDENTIAL_REQUIRED` for all five providers. It performed no inference or native OAuth login. Restore the existing authorized Vault lifecycle before treating any route as live-accepted.

### Checkout project actions

`bash scripts/dev/project-action.sh fleet-sync` warms the shared toolchain
and passes the current checkout HEAD as the exact revision to the existing approval
flow. Extra arguments such as `--dry-run` are forwarded. The manager can bundle
committed objects from this canonical local repository, including unpublished
commits; dirty working files are never transferred. Review and commit desired
changes before approving deployment. The Ubuntu baseline now owns the native
Docker engine, Compose and Buildx on every enrolled Linux workstation, preserving
third-party engine ownership conflicts and existing running workloads. Workstation
launcher/link convergence is part of the node apply, with credentials still checked
separately. A dependency receipt proves frozen installation inputs only.
