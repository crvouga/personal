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

On the destination, restore to an empty directory and validate offline:

```bash
bun run cliproxy restore SNAPSHOT_ID /var/tmp/cliproxy-recovery
python3 -B /opt/cliproxy-fleet/scripts/restore-verify \
  /var/tmp/cliproxy-recovery/opt/cliproxy-fleet
```

Read the recovered `INSTALLATION.json` to identify the exact package commit. Code links in a snapshot may refer to paths on the old host: do not execute restored links. The trusted repository validator compares the recorded hashes with Git objects. Fetch that commit from the repository if needed. Preserve your newly acquired Vault token and recovered password while merging the restored state:

```bash
sudo cp -a /var/tmp/cliproxy-recovery/opt/cliproxy-fleet/state/. /opt/cliproxy-fleet/state/
bun run cliproxy install --revision RECOVERED_COMMIT
bun run cliproxy audit
bun run cliproxy health
bun run cliproxy models
bun run cliproxy inference responses EXACT_AVAILABLE_MODEL_ID
```

The installer fixes local state permissions and starts only this host's restored primary. The snapshot excludes Vault token/password, so the copy preserves the independently recovered files. Application health/inference must pass **before** endpoint activation.

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
