# CLIProxyAPI fleet service

`@pkgs/cliproxy-fleet` owns the source for the private CLIProxyAPI deployment. The package contains Compose configuration, immutable upstream image pins, systemd units, operational scripts, client bootstrap code and recovery procedures. It is private and is not published to npm or as a custom container image.

## Source and installed artifacts

The only executable source is Git-tracked code in `crvouga/personal`. Installation creates a detached sparse Git worktree at `/opt/cliproxy-fleet/revisions/COMMIT`; operational paths under `/opt/cliproxy-fleet` and systemd units are links into that worktree. No executable source is rendered or copied outside Git. Client launchers are also links to the tracked `clients/launcher.py` in a checkout.

`INSTALLATION.json` records the worktree, commit and hashes. `audit` verifies Git tracking, a clean deployed checkout, link targets, systemd links, content hashes and unexpected code. Startup and monitoring enforce it. Uncommitted code is never installed; keep the original Git repository/common object database available, or rebuild a deployment worktree from a fresh clone during recovery.

- **Git:** all executable code, Compose/templates, immutable image pins, unit definitions, clients, tests and runbooks.
- **Vault:** provider-independent credentials and existing recovery keys; never commit secrets.
- **Encrypted R2 snapshots:** live provider/config state, dedicated Tailscale identity and source-revision metadata.
- **Generated non-code data:** private client settings, installation metadata and `.env` image-pin data; their generators are tracked. Runtime data remains separate under `state/`.

## Install, update and rollback

Ubuntu requirements: Docker Engine/Compose, Restic, Python 3 with PyYAML, curl and CA certificates. `sudo packages/cliproxy-fleet/scripts/install-dependencies` installs OS prerequisites from Ubuntu repositories. Developer tools follow the repository's locked mise setup.

From the repository root, after committing/reviewing the package revision:

```bash
bun run cliproxy install --dry-run
bun run cliproxy install --revision HEAD
bun run cliproxy audit
bun run cliproxy status
```

The installer uses sudo for the local system deployment. It preserves the live configuration and credentials, refreshes managed files/units, and restarts only this stack. It never provisions cloud resources or writes Vault secrets. On a fresh host, first use the restore procedure below; do not create a competing active instance with copied credentials.

To update, change the package/image pins in Git, pass package/repository checks, commit, and install the selected revision. To undo a Git revision/image update:

```bash
bun run cliproxy install --rollback
# Or explicitly install a previously reviewed package commit:
bun run cliproxy install --revision PREVIOUS_COMMIT
```

The previous installation revision is recorded separately. Image rollback cannot undo application state migrations; restore a compatible pre-upgrade snapshot when needed. `.env` is generated, so image changes go through `image.lock.json`, not local edits.

## Architecture and endpoints

One upstream CLIProxyAPI v8.0.55 container runs as UID/GID 1000 with a read-only root filesystem, no extra capabilities, bounded CPU/memory/processes and rotated Docker logs. Only `127.0.0.1:8317` is published. A separate nonprivileged userspace Tailscale container proxies over the Compose bridge and keeps its own tagged identity. It does not replace the workstation identity or change SSH/firewall settings. The upstream official dashboard is pinned and checksum-verified; background updates are disabled.

- Stable private origin: **https://ai-proxy.tail4829dc.ts.net**
- OpenAI/Responses base: **https://ai-proxy.tail4829dc.ts.net/v1**
- Official dashboard: **https://ai-proxy.tail4829dc.ts.net/management.html**
- Stable tailnet resource: `svc:ai-proxy`, `tcp:443`; host identity: `tag:ai-proxy`.

Inference requires a client API key. Management uses a separate key; ordinary inference keys cannot authorize admin APIs. HTML is a public asset within the private tailnet, while management data/actions require authentication. Existing broader tailnet policy grants remain in force; application authentication is always enforced. No Funnel/public forwarding is used.

Cloud service definitions, policies and Vault values belong to the OpenTofu platform workflow. The original one-off cloud provisioning/secret-writing helpers have been retired. Do not recreate them in this package. Existing Tailscale Service resources survive workstation replacement; local `activate` advertises an existing resource and is a runtime operation. See [cloud adoption notes](docs/cloud-adoption.md) before changing the cloud definitions.

## State, permissions and configuration

`/opt/cliproxy-fleet/state/` is mode 0700, with restricted files owned by numeric UID 1000. Review that numeric identity on replacement hosts. The inference container mounts only `state/runtime`; it cannot access backup secrets, the Docker socket or dedicated Tailscale state.

| Path under installation     | Purpose                                                                |
| --------------------------- | ---------------------------------------------------------------------- |
| `state/runtime/config.yaml` | Sole authoritative live config, including dashboard edits              |
| `state/runtime/auths/`      | Provider OAuth, account metadata, bbolt store, cooldown state          |
| `state/runtime/static/`     | Pinned official management HTML                                        |
| `state/secrets/`            | Private local material read from Vault and renewable Vault login token |
| `state/tailscale/`          | Dedicated service identity; never run two copies concurrently          |
| `state/network/`            | Encrypted-backup copy of the original policy for operator review       |
| `state/endpoint.json`       | Verified stable endpoint metadata                                      |
| `state/status/`             | Operational results and shared operation lock                          |
| `INSTALLATION.json`         | Git revision and hashes of generated installed code                    |

`config.template.yaml` is a versioned starting policy, not a second live config. Initialization never overwrites an existing live config. Dashboard edits persist in the directory mount and hot-reload. Reconcile intended nonsecret policy changes into the Git template manually; never commit a credential-bearing config export. CLI updates use `apply FILE`: safety validation and credential-free isolated container staging before replacement/restart. Upstream has no exhaustive standalone config checker; staging does not prove every provider option is valid.

## Routine commands

Run these from the repository; operational commands use the installed revision's scripts:

```bash
bun run cliproxy audit
bun run cliproxy start
bun run cliproxy stop
bun run cliproxy restart
bun run cliproxy status
bun run cliproxy health
bun run cliproxy models
bun run cliproxy logs
bun run cliproxy validate
bun run cliproxy apply /protected/candidate.yaml
```

Docker restart policy recovers process crashes. Systemd enables startup independently of desktop sessions. A health probe checks HTTP/auth reachability, and the five-minute monitor checks code provenance, application/admin authentication, backup freshness and Vault failures. Persistent unhealthy states are surfaced, not hidden by automatic restart loops. `logs` is best-effort redaction; keep debug and request logging disabled. External notification delivery is not configured.

## Providers and model selection

One OpenAI/Codex account was explicitly authorized during the initial deployment. Native coding-client OAuth files were not imported. Anthropic and Google require their own supported authorization/API-key setup in the official dashboard. All provider credentials stay server-side.

```bash
bun run cliproxy add-account codex
bun run cliproxy add-account claude
bun run cliproxy models
bun run cliproxy inference responses EXACT_CODEX_MODEL_ID
bun run cliproxy inference messages EXACT_CLAUDE_MODEL_ID
```

Codex uses the upstream device-code flow. Remote callback flows may require the documented dashboard callback flow or temporary SSH loopback forwarding; callback ports are not exposed by default. This pinned version has no generic Gemini CLI login flag; use its supported dashboard/API-key integration. Provider rules still govern permissible account use.

Routing uses round robin, session affinity, cooldowns and bounded retries across eligible accounts for the requested model. Automatic preview-model switching is disabled; no hidden cross-model/provider aliases are configured. Usage statistics are enabled but are not a durable billing ledger. Available quota details depend on the provider.

## Fleet clients: macOS, Ubuntu and Windows/WSL

Use the same versioned bootstrap from this repository on every machine. Requires Python 3 and the desired client installed via the shared toolchain. No remote machine is changed automatically.

```bash
python3 packages/cliproxy-fleet/clients/bootstrap.py \
  --endpoint https://ai-proxy.tail4829dc.ts.net \
  --model gpt-6.1-sol
python3 packages/cliproxy-fleet/clients/bootstrap.py --validate
~/.local/bin/codex-fleet
~/.local/bin/opencode-fleet
```

Enter the inference key at the hidden prompt. It is available in Vault `secret/personal/prd:CLIPROXY_FLEET_CLIENT_API_KEY`; dashboard login uses `CLIPROXY_FLEET_MANAGEMENT_KEY`. Secrets never appear in command arguments. Keys are saved mode 0600 and loaded only into child environments. Give runners separate revocable inference keys where needed, never provider OAuth credentials or the admin key.

Codex uses custom-provider CLI overrides and Responses HTTP/SSE. Claude uses its supported base URL/auth-token variables and an explicit Claude model. OpenCode uses its config-file override, with separate Responses and Anthropic SDK providers. Once Claude is authenticated, rerun with `--claude-model MODEL_ID`; otherwise the Claude launcher fails with an explicit setup requirement. Native client config files are preserved. Use plain native clients during a proxy outage.

Run bootstrap from a repository checkout containing `clients/launcher.py`; detached downloaded bootstrap files are unsupported. Bootstrap is idempotent and refuses unrelated launcher collisions. `--uninstall` removes launcher links while retaining private settings for deliberate cleanup. On Windows run inside WSL; native PowerShell launchers are not provided. Validate from each actual machine and target repository because OpenCode merges project settings.

## Vault, backups and restore

Every backup operation fetches current `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID` and `S3_SECRET_ACCESS_KEY` from Vault `secret/personal/prd`. No S3 keys are cached. The existing production R2 bucket uses only `cliproxy-fleet/restic`, with forced path-style addressing. Destination changes are detected against `state/repository.json`; review an intentional repository migration rather than silently changing destinations.

```bash
bun run cliproxy vault-login
bun run cliproxy verify-recovery
bun run cliproxy backup
bun run cliproxy snapshots
bun run cliproxy check-full
```

Vault login is interactive with hidden input; its token is restricted locally and renewed every 15 minutes where permitted. Maximum token lifetime still applies; re-login when renewal is no longer allowed. The Restic password has an independent existing copy at `CLIPROXY_FLEET_RESTIC_PASSWORD`. Secret creation/rotation goes through the platform's `bun run vault:edit`/OpenTofu workflow, not runtime helpers.

Daily backups run around 03:15 Phoenix time with up to 15 minutes jitter. They stop only this stack briefly for a consistent snapshot and resume exactly the previously running services, including on failure. Retention: 7 daily, 5 weekly, 12 monthly. Weekly Sunday 05:00 checks repository structure and 10% of data; `check-full` reads all data. Physical pruning is deliberate maintenance. Backup and integrity-check failures use separate markers; monitoring fails for a missing/older-than-36-hours backup. The latest successful snapshot ID is recorded in `state/status/backup-success.json`.

Encrypted snapshots include live config, OAuth/account state, client/admin keys, source-revision metadata and dedicated Tailscale identity. Git worktrees are excluded: recover code from the repository at the recorded commit, not from copied executable files. Docker images, logs, status files, Vault token, encryption password and recovery-confirmation marker are excluded. Recover Vault access independently; losing both Vault recovery and the local Restic password makes snapshots unreadable.

For a fresh machine, clone this repository, install OS prerequisites, and materialize the committed package in `/opt/cliproxy-fleet` without starting the service using the installer module's documented recovery procedure in [migration](docs/migration.md). Then log into Vault, recover the existing password, restore to an empty staging directory and verify it offline. Do not initialize new provider credentials or run a second restored identity concurrently.

## Verification and checks

```bash
bun run --filter @pkgs/cliproxy-fleet lint
bun run --filter @pkgs/cliproxy-fleet test
```

Explicit integration checks are also versioned: `python3 -B packages/cliproxy-fleet/tests/live.py --codex --recovery --restore`. They read the existing deployment/Vault login, spend a small number of provider tokens and restore only into a temporary offline directory. Add `--opencode` when the locked OpenCode CLI is installed; no tool is installed automatically.

Offline checks cover syntax/pins, source-only installation, state preservation, manifest drift/unmanaged-code detection, rollback metadata, and repeatable client bootstrap preserving native settings. Integration verification is explicit and uses inexpensive inference. See [initial deployment evidence](docs/deployment-verification-2026-11-04.md) and [migration/restore commands](docs/migration.md). Mac/WSL remote tests, additional provider authentication and a physical host migration remain operator-run checks.

Sources: [upstream release](https://github.com/router-for-me/CLIProxyAPI/tree/v8.0.55), [official dashboard](https://help.router-for.me/management/webui), [Codex config](https://learn.chatgpt.com/docs/config-file/config-reference), [Claude gateway](https://code.claude.com/docs/en/llm-gateway-connect), [OpenCode providers](https://opencode.ai/docs/providers/), [Tailscale Services](https://tailscale.com/docs/features/tailscale-services). The vendored upstream config is retained as version-specific schema documentation, not live configuration.
