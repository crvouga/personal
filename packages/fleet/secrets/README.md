# Encrypted role secrets only

Do not commit plaintext, PEMs, age private keys, or decrypted example files here. Each role has its own age key and its own sops file. CI and web must never share either. Cache and netboot do not use `secrets/fleet.yaml` or `secrets/web.yaml`.

| Role    | Key on the work computer               | Encrypted file         | Settings      |
| ------- | -------------------------------------- | ---------------------- | ------------- |
| ci      | `$HOME/.config/fleet/keys/ci.age`      | `secrets/fleet.yaml`   | `fleet.nix`   |
| web     | `$HOME/.config/fleet/keys/web.age`     | `secrets/web.yaml`     | `web.nix`     |
| cache   | `$HOME/.config/fleet/keys/cache.age`   | `secrets/cache.yaml`   | `cache.nix`   |
| netboot | `$HOME/.config/fleet/keys/netboot.age` | `secrets/netboot.yaml` | `netboot.nix` |

`FLEET_KEY_DIR` overrides the directory. `secretsFile = null` until that role's file exists, so the flake evaluates before bring-up. Bootstrap copies the matching private key to `/nix/fleet-state/secrets/age.key` (mode 0600) on the persistent `/nix` partition. It is never built into an ISO and never printed. Generate the key with `age-keygen`. This package does not.

Root-only decryption produces `/run/secrets/*`. CI runner slots receive only one-hour registration tokens. A compromised node exposes that role's key, so this remains a trusted private-code fleet.

CI YAML contains `github-app-key` (the PEM as a block scalar). Optional CI scratch-cache entries are `cache-credentials` (AWS shared-credentials INI) and `cache-signing-key` (a Nix private signing key). Those are not the attic server. The cache role's YAML contains `attic-env`, an env file whose value is `ATTIC_SERVER_TOKEN_RS256_SECRET_BASE64=...`. Do not generate that RSA material into the Nix store. Web app environment is a sops key named by `envSecret`.

When `repo.auth` is `ssh` or `token`, encrypt `git-read-key` or `git-read-token` into each role's own file. The ciphertext is per age key, so the same GitHub read credential is encrypted separately for each role. Do not copy one role's yaml onto another to avoid that.

```sh
umask 077
mkdir -p "$HOME/.config/fleet/keys"
age-keygen -o "$HOME/.config/fleet/keys/ci.age"
age-keygen -y "$HOME/.config/fleet/keys/ci.age"
# Repeat for web, cache, and netboot. Confirm the four files differ.
# Write the YAML outside Git. Do not paste key material into shell history.
sops --encrypt --age AGE_PUBLIC_RECIPIENT --input-type yaml --output-type yaml \
  "$HOME/.config/fleet/fleet.plain.yaml" > secrets/fleet.yaml
```

Commit only the encrypted YAML. Remove the local plaintext after the backup exists. No fake encrypted placeholder is shipped.
