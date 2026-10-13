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

## Rotate a role key without SSH

The private key never enters git. The running node already has it at `/nix/fleet-state/secrets/age.key`. Rotation is two commits. `ci-gpu` uses `ci.age`, so rotating `ci` covers both. Do not generate the key in this package. Do not copy it over SSH.

1. On the work computer, `age-keygen -o` a new key outside the repo. Keep the old key until every node of that role has pulled the second commit.
2. Re-encrypt that role's YAML to both the old public recipient and the new one. Add `age-key-next` whose value is the new private key, encrypted to the old recipient. Set `rotateAgeKey = true` in that role's settings file in the same commit. Merge it. The node pulls, decrypts `age-key-next` with the key it already has, and `fleet-age-rotate` installs it over `/nix/fleet-state/secrets/age.key`.
3. Re-encrypt the YAML to only the new recipient, remove `age-key-next`, and set `rotateAgeKey = false`. Merge that. Confirm the node reaches the new commit (`fleet-drift` and `/etc/fleet/revision`). Then delete the old private key from the work computer's backup store.
4. A node that never pulled the first commit cannot decrypt the second. Reinstall that node from the netboot flag instead of SSHing a key onto it. Bootstrap copies the new key the same way it copied the first one.
