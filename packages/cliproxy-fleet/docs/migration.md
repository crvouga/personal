# Restore and migration

One primary instance is sufficient. Never activate duplicated OAuth or Tailscale identities concurrently. Source code comes from this package at the commit recorded in the backup's `INSTALLATION.json`; secrets and state come from Vault and encrypted R2 snapshots.

## Prepare recovery tooling on a new Ubuntu host

Clone `crvouga/personal` and check out a reviewed revision containing this package. Use the shared locked developer toolchain, or Python directly for the installer. Install OS prerequisites, then prepare code without starting the proxy:

```bash
sudo packages/cliproxy-fleet/scripts/install-dependencies
bun run cliproxy install --prepare-only --revision HEAD
bun run cliproxy vault-login
bun run cliproxy recover
bun run cliproxy snapshots
bun run cliproxy check-full
```

`vault-login` creates its private state directories and prompts locally with hidden input. `recover` reads the existing Restic password from Vault; it never generates or writes cloud secrets. Do not run `initialize` before recovery.

## Final snapshot and cutover

On the source, stop scheduling before freezing it. Local drain affects only the existing dedicated Service advertisement:

```bash
sudo systemctl disable --now cliproxy-backup.timer cliproxy-backup-check.timer
bun run cliproxy drain
bun run cliproxy stop
sudo systemctl disable cliproxy-fleet.service
bun run cliproxy backup
bun run cliproxy snapshots
```

An already stopped stack remains stopped after backup. Record the **latest successful snapshot ID** from `/opt/cliproxy-fleet/state/status/backup-success.json`; do not choose an incomplete snapshot from a failed backup.

On the destination, confirm that the old host is stopped or powered off. The acknowledgement below is operator fencing, not a distributed lock. Recover the latest modern checkpoint directly into the empty cache:

```bash
bun run cliproxy restore-cache --previous-node-stopped
bun run cliproxy install --revision HEAD
bun run cliproxy audit
bun run cliproxy health
bun run cliproxy public-endpoint verify
python3 -B packages/cliproxy-fleet/tests/live.py --endpoint https://cli-proxy.chrisvouga.dev --codex
bun run cliproxy backup
```

Recovery uses the current trusted Git checkout, validates decrypted data, and preserves the new Vault login and independently recovered Restic password. It never executes backed-up code. `install` regenerates secret caches from Vault and starts the recovered service; it refuses missing runtime config. To reproduce the original software version, read the recovered checkpoint's `INSTALLATION.json` in an offline restore first and choose that reviewed Git revision instead of HEAD.

`restore-cache` intentionally refuses an existing `runtime`, `tailscale` or endpoint cache. An existing repository pin must match the restored destination. For recovery on the same host, stop the service/timers and move these cache entries to a private rollback directory first. Never move `state/status/operation.lock` while an operation is active. An interrupted recovery leaves `state/recovery-incomplete`; inspect/remove the partial cache before retrying. Keep `state/secrets` (new Vault login/password) and the lock directory intact.

For offline inspection or historical recovery, use `bun run cliproxy restore SNAPSHOT_ID /var/tmp/cliproxy-recovery`, then `python3 -B /opt/cliproxy-fleet/scripts/restore-verify /var/tmp/cliproxy-recovery`. Modern checkpoints are located automatically despite different source paths. Old snapshots without `CHECKPOINT.json` require the original explicit restored deployment path and manual state recovery. No automatic fallback to an older snapshot occurs when validation fails.

The existing Tailscale Service remains in the cloud. Reuse the restored dedicated identity only while the original is stopped. Local runtime commands activate it and resume its existing advertisement:

```bash
bun run cliproxy activate
```

If a drained identity requires re-advertising, use the pinned Tailscale CLI's `serve advertise` command for `svc:ai-proxy`, then inspect `serve status`. Do not change the workstation's ordinary Tailscale identity or assume hostnames transfer. A new tagged identity/service definition requires the platform's OpenTofu-managed enrollment/approval workflow; no cloud provisioning helper exists in this package.

From the Mac Studio and another fleet device, run the client bootstrap's `--validate`, then an actual client/tool request through `https://ai-proxy.tail4829dc.ts.net`. Create and verify a destination backup, enable its backup timers, and keep the source service/timers disabled. Disable the old monitor/renew timers when retiring that host. Remove temporary plaintext restore copies after verification.

## Rollback a failed move

First drain/stop the destination and disable its service/backup timer. If it refreshed credentials or changed config, take a consistent destination snapshot and restore that newest state onto the stopped source before restarting it; old OAuth refresh tokens may be invalid. Otherwise retain the original source state. Activate exactly one identity/primary, restore its Service advertisement and enable its timers. Verify the stable endpoint from fleet clients before declaring rollback complete.

A normal code/image rollback uses `bun run cliproxy install --rollback`. That restores a recorded Git revision, not application data. For incompatible state migrations, restore a matching pre-upgrade snapshot while stopped.

## Public hostname cutover

The public DNS/tunnel resources remain owned by OpenTofu. A restored `state/public-endpoint-enabled` marker makes service startup fetch the current isolated tunnel credential from Vault and start the connector automatically. The tunnel token itself is excluded from snapshots. If the marker is absent, run `bun run cliproxy public-endpoint enable` after restoring and stopping the old primary. Verify with `bun run cliproxy public-endpoint verify` and `tests/live.py --endpoint https://cli-proxy.chrisvouga.dev --codex`. Client API and management keys do not change; keep the old primary stopped during recovery.
