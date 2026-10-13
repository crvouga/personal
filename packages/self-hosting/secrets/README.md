# Encrypted fleet secrets only

Do not commit plaintext, PEMs, age private keys, or decrypted example files here. The shipped `fleet.nix.secretsFile = null` keeps the flake evaluable before bring-up; registrations fail until configured. Encrypt a YAML document containing `github-app-key` (the PEM as a block scalar) with the fleet age public recipient, then set `secretsFile = ./secrets/fleet.yaml`. Optional remote cache entries are `cache-credentials` (AWS INI) and `cache-signing-key` (Nix private signing key).

The shared age private key is backed up outside Git and transferred after installation to `/nix/fleet-state/secrets/age.key` via `just provision-secrets NODE KEY`. It is never built into an ISO. Root-only decryption produces `/run/secrets/*`; runner slots receive only one-hour registration tokens. Compromise of any node can expose the shared fleet credential, so this is a trusted private-code fleet, not a public compute service.

Web servers do not use this file or this age key. Encrypt a separate `secrets/web.yaml` for a web-only age recipient, then set `web.nix` `secretsFile`. App environment is a sops key named by `envSecret` and appears only at `/run/secrets/<name>` on web hosts.
