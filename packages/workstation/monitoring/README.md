# Beszel owner and recovery

Fleet's [manager guide](../../fleet/docs/ubuntu-sync.md) is the normal entry
point: `npx @crvouga/personal fleet-sync`, run on the manager. Workstation owns the
pinned Compose hub, native agent units and local Ansible tasks here. Fleet owns
membership, registration and freshness evidence. `lock.json` pins Beszel 0.21.1
and the native agent checksums. Never run an unpinned upstream installer
alongside these services.

## Manager and workers

The fleet has exactly two roles (Fleet `definition.json`, version 3):

- **Manager** — the human's macOS machine. It runs fleet-sync locally and hosts the
  singleton hub (`cli/lib/monitoring/manager-hub.ts`, `convergeManagerHub`). Fleet
  keeps it awake on AC power. Nothing is installed on it over SSH.
- **Workers** — the stateless Linux boxes. They only run the native agent
  (`agent.yml`, a hardened systemd unit) and connect to the manager's private hub
  URL. A worker refuses hub mode (`BESZEL_NOT_HUB`: the hub runs only on the
  manager) and an agent refuses any other hub URL (`BESZEL_HUB_MISMATCH`).

`agent-darwin.yml` installs the same pinned binary on a macOS machine as a root
launchd daemon with `KeepAlive`; `lock.json` carries the darwin checksums. It is
best effort and less sandboxed than the Linux unit.

## Hub on the manager

`hub-darwin.yml` runs as the signed-in user (no sudo) under Docker Desktop, which
must be running (`BESZEL_DOCKER_DESKTOP_REQUIRED`); enable _Start Docker Desktop
when you sign in_. It refuses to replace a different existing image
(`BESZEL_HUB_UPGRADE_PENDING`). Paths are per-user and `0700`:

- data: `~/Library/Application Support/personal-beszel` (bind-mounted as
  `/beszel_data`; it is in the human's normal home backups, but use the stock
  backups below for consistent copies);
- connector token: `~/Library/Application Support/personal-beszel-tunnel/token`
  (`0600`).

The dashboard is `https://<manager-MagicDNS-name>:8443`
(`hubUrl(definition)`), linked in the consolidated CLI result. The Compose port is
loopback-only; Tailscale Serve (`tailscale serve --bg --https=8443
http://127.0.0.1:8090`, using `tailscale` on PATH or the app's
`/Applications/Tailscale.app/Contents/MacOS/Tailscale`) provides private HTTPS.
No Funnel or inbound listener is configured. Convergence passes `beszel:hub` only
after `/api/health` answers both locally and at the private URL. Before enrolling
agents, fleet-sync requires that URL to answer; otherwise workers report
`BESZEL_HUB_UNREACHABLE` (keep the manager awake and Docker Desktop running).

The same hub is also served at `https://beszel.chrisvouga.dev` through an
outbound-only Cloudflare Tunnel: the inventory's
`cloudflare.additional_tunnels.beszel` entry makes OpenTofu own the tunnel, its
proxied DNS record and the isolated `secret/beszel/tunnel` Vault document. The
hub converge reads that document with the manager's own Vault session (the
human's session; never printed or placed in argv), writes it to the per-user
token file and starts the pinned `cloudflared` Compose profile. Until the
credential is readable the step warns (`BESZEL_TUNNEL_CREDENTIAL_UNAVAILABLE`)
and the private dashboard is unaffected. Agents and the manager keep using the
private URL; `fleet-status --workers` reports the public hostname as a
warning-level `beszel:public-endpoint` check. The hub's own login still guards
the public URL.

Native agents use outbound authenticated WebSockets, per-node tokens and
persistent identity. They do not need inbound SSH monitoring ports, Docker socket
access or journals.
`SKIP_SYSTEMD_LOGS=true` deliberately excludes potentially sensitive service logs.
System services may be visible; user T3 service information is not certified by
that fact. Missing sensors, SMART privileges, Docker stats and user-service metrics
remain unavailable until their specific supported permissions are reviewed.

Create the first (superuser) hub account through its private stock UI. Manager
enrollment uses the normal Beszel account `fleet-manager@chrisvouga.dev`, whose
password OpenTofu generates as `BESZEL_FLEET_AUTH` in `secret/personal/prd`; create
that user in the hub with the generated password and grant it the fleet systems.
The hub runs with `SHARE_ALL_SYSTEMS=true`, so systems that account registers are
visible to every hub login.
A legacy JSON `identity`/`password` value is still accepted. The manager's existing
Vault credential must renew unattended. Superuser credentials are not distributed
to nodes or needed for enrollment. Revocation produces action-required results.

Configure network monitors and alert thresholds once in the stock UI; these
settings are runtime application data, preserved in backups. Select explicit probe
origins rather than an all-to-all mesh. Use sustained resource-pressure alerts,
disk capacity, offline nodes and supported temperatures. Do not send notifications
until an authorized destination exists. Service-failure alert delivery has not
been accepted against this pinned release.

## Stock backup and restore

1. Open the hub's private PocketBase administration route `/_/` and authenticate
   as its superuser. Keep that credential separate from fleet enrollment access.
2. Open **Settings → Backups**. Create and download a backup before maintenance.
   Set scheduled backups and retention there using existing authorized storage.
   Do not provision a bucket or reuse unrelated credentials to bypass access gates.
3. Protect downloaded archives as secrets: they contain registrations, tokens,
   account data, alert configuration and history. Use the existing approved
   encrypted backup destination; a backup on the same disk is not disaster recovery.
4. Restore the archive into an isolated instance of the same pinned release with
   outbound agent connections blocked. Use the stock upload/restore action, never
   database edits. Restoring restarts the hub. Verify original node IDs, fingerprints,
   history and settings before selecting a replacement host. Fence the old hub
   before production recovery; never operate two copies of its identity.
5. Run the manager command and require new metric timestamps after recovery.
   Old historical samples do not prove agent connectivity.

## Moving the hub to the manager

The hub previously ran on worker `chris-vouga-ms-a2` (`/var/lib/personal-beszel`,
Compose project `personal-beszel`). Move it once, as an operator, in this order;
never run two copies of its identity or two tunnel connectors:

1. On ms-a2, create and download a stock backup (**Settings → Backups**) and keep
   it as a secret.
2. Fence the old hub on ms-a2: `sudo docker compose -p personal-beszel down`
   (stops the hub and its `cloudflared` connector; keep `/var/lib/personal-beszel`
   untouched until the move is verified), then
   `sudo tailscale serve --https=8443 off`.
3. On the manager, with Docker Desktop running, run fleet-sync to converge the
   empty hub, then restore the backup through the stock **Backups** upload/restore
   action as its superuser. Alternatively, with both hubs stopped, copy the
   fenced `/var/lib/personal-beszel` contents into
   `~/Library/Application Support/personal-beszel` before the first start.
4. Confirm the restored node IDs, fingerprints, history, settings and the
   `fleet-manager@chrisvouga.dev` account, then run fleet-sync so agents
   re-enroll against the manager URL and report fresh samples.
5. Only after verification, remove ms-a2's hub data and its `beszel-hub-read`
   Vault grant (OpenTofu).

`tests/upstream.py` exercises real pinned binaries with disposable loopback data:
authenticated registration, fresh metrics, restart identity preservation, no duplicate
record, and the supported PocketBase backup/restore API. It does not contact live
nodes, prove Tailscale routing, verify systemd reboot, or test an off-host encrypted
backup destination. Those remain explicit release/operational gates.

References: [agent](https://beszel.dev/guide/agent-installation),
[systemd](https://beszel.dev/guide/systemd),
[network monitors](https://beszel.dev/guide/network-monitors),
[backup API](https://pocketbase.io/docs/api-backups/).
