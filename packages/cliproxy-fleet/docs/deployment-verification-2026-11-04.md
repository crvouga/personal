# Verification — 2026-11-04 (America/Phoenix)

Deployment: `/opt/cliproxy-fleet`. Stable private HTTPS endpoint: `https://ai-proxy.tail4829dc.ts.net`. Dashboard: `/management.html`.

## Observed passes

- Ubuntu 26.04.1 LTS, x86_64, about 59 GiB RAM and 785 GiB free at inspection. No existing Docker/CLIProxyAPI/Restic deployment or mounted independent backup destination was found. Existing development repositories were preserved.
- Docker Engine 29.1.3, Compose v2.40.3, Restic 0.18.1 and ShellCheck installed from signed Ubuntu repositories. System Docker and existing Tailscale daemon enabled.
- Upstream CLIProxyAPI v8.0.55 pinned to `sha256:afe1135e8d8752867b73d717c1ca8ed27c44bfe8c6e1a2bebf228dba98889eac`. The native test release checksum was also verified against upstream release checksums.
- Official Management Center v1.27.2 HTML SHA-256 verified against `2f6cf57a8ca4ace1fadde0280cbd41084f56999738d0e692a30b135420f7fc30`; background panel updates disabled.
- Upstream Tailscale container v1.104.4 pinned to `sha256:ed6480b33c6eb67c9cbd203ed42b9fb57e361986725b6856def71b7a3d9e276c`. Dedicated tagged node runs userspace networking as UID 1000 with all capabilities dropped.
- Proxy healthy as nonroot UID 1000 with read-only root filesystem, no extra capabilities, resource/process limits, rotated logs and only a loopback host port. Neither proxy nor tailnet is privileged. Proxy cannot access Vault/Restic secrets, Tailscale state or the Docker socket.
- YAML and security-invariant validator passes; actual pinned container starts successfully in isolated staging without provider credentials. An invalid management configuration was rejected before any change to the live config.
- Host-level SIGKILL of the proxy process triggered Docker restart (restart count incremented). Explicit `docker kill` is a manual Docker stop and was not used as evidence of failure-policy recovery.
- Full systemd service restart brought back proxy and dedicated tailnet container, preserving Codex credentials. Units validate with `systemd-analyze verify`; service and four timers are active/enabled. No host reboot was performed.
- Stable Service `svc:ai-proxy` defined and its HTTPS access verified with normal TLS certificate validation. Anonymous model listing returns 401, authenticated listing returns 200, inference key cannot access management (401), management key can (200), and official dashboard HTML returns 200.
- Existing workstation HTTPS port 443 route to `127.0.0.1:3773` remained unchanged and returns 200. The temporary diagnostic port 8443 route was removed after stable service activation. Existing workstation identity and SSH settings were preserved. UFW remains inactive; it was not enabled or disabled by the deployment.
- One Codex account authorized explicitly by the user through upstream device-code login. Fourteen model IDs listed after container recreation.
- Cheap Responses SSE inference succeeded with `gpt-6.1-sol`.
- Actual installed Codex client and generated `codex-fleet` launcher tested through the stable Tailscale HTTPS endpoint using an isolated CODEX_HOME: streamed response, shell tool execution reading a temporary probe file, and expected final text all passed.
- Actual OpenCode v1.19.5, downloaded to a temporary directory and verified against its official release digest, tested through the generated launcher with isolated config/data/cache: custom Responses provider, stable HTTPS streaming, and expected final text passed. It was not globally installed.
- Fleet bootstrap tested in an isolated home for repeatability, preservation of native settings, protocol-specific launcher arguments/environment, private key handling and uninstall behavior. No remote machine configuration was changed. Local opt-in launchers installed; native client config files remain unchanged.
- Known current client/admin/provider/Vault/backup secret values were absent from application logs. Restricted secret-file permissions checked. These checks do not prove that every future upstream error message will be safe; keep debug/request logging off and use the redacting log command.
- Vault token validation/renewal succeeded. Every Restic operation fetches fresh S3 credentials from Vault. No S3 credentials are cached on disk. Tailscale admin API token is read live from Vault and is not mounted into containers.
- Independent recovery password and initial client/admin keys saved to `secret/personal/prd` using compare-and-set, preserving existing fields, and readback verified without printing values.
- Encrypted Restic repository initialized in existing production R2 bucket at `cliproxy-fleet/restic`. Snapshot `9286b5e4` created successfully with the application stopped consistently and resumed afterwards. Full repository/data check passed with no errors. Restic restored and verified all 53 files into an isolated directory; offline config, dashboard, pinned metadata and one OAuth JSON file validated.
- Recovery tooling started with no local Restic password, retrieved the independent password from Vault and successfully decrypted/listed the remote repository. Temporary recovery-token copies were removed with their temporary directory.
- Daily backup, weekly integrity check, five-minute health/backup-freshness check, and 15-minute Vault token-renewal timers enabled. Backup freshness and Vault checks pass. Final deployment snapshot/check is run after documentation is written.

## Deliberate limits and remaining operator actions

- Anthropic/Claude and Google/Gemini are supported by the upstream deployment but are not authenticated. Authorize them through the official dashboard or supported API-key/OAuth flow before enabling their fleet client/model selections. Claude launchers explicitly refuse to run without a selected Claude model. No non-Claude substitution is made.
- Claude Code live inference, multiple-account failover, real quota exhaustion, and model-specific reasoning combinations beyond the Codex/OpenCode checks have not been exercised. No provider quota was intentionally exhausted.
- Mac Studio was offline during a Tailscale reachability probe. macOS/WSL/remote runners are not configured or tested automatically. Use the exact bootstrap/validation commands in README on each device; test a real client tool call there.
- The management HTML and protected APIs were verified, but no browser automation was available to test every dashboard interaction.
- No real migration, complete physical-machine failure or reboot was induced. Restore was isolated/offline; duplicated provider credentials were never activated concurrently. An actual move uses the stop/final-backup/restore/health/inference/service-cutover procedure in README.
- Upgrade/rollback tooling uses pinned images and isolated staging, but no downgrade to an older application release was performed. State-schema compatibility must be reviewed for each real upgrade; image rollback cannot undo state migrations.
- New Vault key names (`CLIPROXY_FLEET_RESTIC_PASSWORD`, `CLIPROXY_FLEET_CLIENT_API_KEY`, `CLIPROXY_FLEET_MANAGEMENT_KEY`, and operator-added `TAILSCALE_API_TOKEN`) need reconciliation into the personal infrastructure's OpenTofu-owned registry/secret inputs before a future apply. This is documented in `VAULT-REQUEST.md`; no public issue or remote repository was created.
- Vault renewal is subject to the server's maximum token lifetime; re-login is required when renewal is no longer allowed. API-token expiry/revocation requires replacement in Vault. These conditions fail closed and surface in monitoring; no credentials are guessed or silently substituted.
- Alerts are local systemd failures/status files; an external notification destination was not provided. Retention forgets snapshots, while physical pruning remains a deliberate maintenance operation. Usage counters are not advertised as a durable billing ledger.
- Tailnet changes were additive and preserved existing policy semantics. Existing broader grants still apply; the new service-specific grant does not override those. Application authentication is always enforced.
