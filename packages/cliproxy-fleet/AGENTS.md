# CLIProxyAPI package

This package owns reproducible local deployment and runtime operations. Authored code/config templates must be committed here before installation. Never patch `/opt/cliproxy-fleet`; it is a generated artifact audited against a Git commit. Preserve `state/` during updates, and keep it out of Git. Secrets live in Vault and encrypted backups.

Do not add cloud provisioning, tailnet policy mutation, Vault writes or secret seeding here. Those belong to the repository's OpenTofu roots. Runtime login, token renewal, local advertisement of existing Services, secret reads and backup operations are allowed. Never print credentials or activate a second copy of provider/Tailscale state during restore tests.

Check with `bun run --filter @pkgs/cliproxy-fleet lint` and `test`. Tests must be offline and must not read the production Vault token or deployment. Installation uses committed blobs and records a manifest; cover state preservation and drift detection when changing that boundary.
