# Beszel owner and recovery

Fleet's [controller guide](../../fleet/docs/ubuntu-sync.md) is the normal entry
point: `npx @crvouga/personal fleet-sync`. Workstation owns the pinned Compose hub,
native agent unit and local Ansible tasks here. Fleet owns membership, registration
and freshness evidence. `lock.json` pins Beszel 0.21.1 and both native architecture
checksums. Never run an unpinned upstream installer alongside these services.

`agent-darwin.yml` installs the same pinned binary on macOS nodes as a root launchd
daemon with `KeepAlive`; `lock.json` carries the darwin checksums. It is best
effort and less sandboxed than the Linux unit. The hub itself stays on Linux.

The singleton host is selected in Fleet `definition.json`. Its dashboard is
`https://<enrolled-hub-MagicDNS-name>:8443`, linked in the consolidated CLI result.
The Compose port is loopback-only; Tailscale Serve provides private HTTPS. No
Funnel or inbound listener is configured. The same hub is also served at
`https://beszel.chrisvouga.dev` through an outbound-only Cloudflare Tunnel: the
inventory's `cloudflare.additional_tunnels.beszel` entry makes OpenTofu own the
tunnel, its proxied DNS record and the isolated `secret/beszel/tunnel` Vault
document (readable only by the hub node's `beszel-hub-read` worker token). The
hub converge reads that document with the node's own login, writes it to a
root-owned file and starts the pinned `cloudflared` Compose profile; until the
credential exists the step warns (`BESZEL_TUNNEL_CREDENTIAL_UNAVAILABLE`) and the
private dashboard is unaffected. Agents and the controller keep using the private
URL; `fleet-status --workers` reports the public hostname as a warning-level
`beszel:public-endpoint` check. The hub's own login still guards the public URL.
On a fresh selected hub, Workstation installs the pinned native Ubuntu Docker engine and Compose from the reviewed snapshot. Existing engines retain their owner; incomplete third-party installations or missing Compose support require repair through that owner. No running engine is restarted merely to install monitoring. Native agents
use outbound authenticated WebSockets, per-node tokens and persistent identity.
They do not need inbound SSH monitoring ports, Docker socket access or journals.
`SKIP_SYSTEMD_LOGS=true` deliberately excludes potentially sensitive service logs.
System services may be visible; user T3 service information is not certified by
that fact. Missing sensors, SMART privileges, Docker stats and user-service metrics
remain unavailable until their specific supported permissions are reviewed.

Create the first (superuser) hub account through its private stock UI. Controller
enrollment uses the normal Beszel account `fleet-controller@chrisvouga.dev`, whose
password OpenTofu generates as `BESZEL_FLEET_AUTH` in `secret/personal/prd`; create
that user in the hub with the generated password and grant it the fleet systems.
A legacy JSON `identity`/`password` value is still accepted. The controller's existing
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
5. Run the controller command and require new metric timestamps after recovery.
   Old historical samples do not prove agent connectivity.

`tests/upstream.py` exercises real pinned binaries with disposable loopback data:
authenticated registration, fresh metrics, restart identity preservation, no duplicate
record, and the supported PocketBase backup/restore API. It does not contact live
nodes, prove Tailscale routing, verify systemd reboot, or test an off-host encrypted
backup destination. Those remain explicit release/operational gates.

References: [agent](https://beszel.dev/guide/agent-installation),
[systemd](https://beszel.dev/guide/systemd),
[network monitors](https://beszel.dev/guide/network-monitors),
[backup API](https://pocketbase.io/docs/api-backups/).
