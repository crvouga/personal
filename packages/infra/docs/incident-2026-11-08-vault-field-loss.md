# Incident 2026-11-08: Vault fields removed by an incomplete input

## What happened

The CI **Apply vault** step at 2026-11-08T18:33Z wrote `secret/personal/prd`
version 148 from the `TOFU_VAULT_INPUTS` GitHub secret (owned by the foundation
root's `vault_inputs`). That input predates four operator-added fields, so the
complete-map apply removed them:

- `CLIPROXY_FLEET_CLIENT_API_KEY`: every proxy provider (T3 "Personal CLI
  Proxy", "Shared provider accounts", fleet provider verification)
- `CLIPROXY_FLEET_MANAGEMENT_KEY`: CLI Proxy dashboard/management
- `CLIPROXY_FLEET_RESTIC_PASSWORD`: CLI Proxy encrypted backups; losing it makes
  existing backups unrecoverable
- `TAILSCALE_API_TOKEN`

Version 147 still holds all four. The mount keeps 10 versions (139–148 on
2026-11-08), so every new `personal/prd` write moves 147 closer to deletion.
Symptoms: `PROVIDER_UNATTENDED_CREDENTIAL_REQUIRED` in `fleet-sync`, failing
**CLI proxy health schedule** runs, T3 proxy instances unavailable.

## Guard (this branch)

The four fields are now `required` prd entries in `vault.kv_keys`. An apply whose
input omits them fails the `vault_kv_secret_v2.personal` precondition instead of
deleting them. **Do not merge this branch until restoration is complete**, or the
deploy's Apply vault step fails (by design) until `TOFU_VAULT_INPUTS` is fixed.

## Restore (OpenTofu only; never `vault kv put`)

Prerequisites: an admin Vault session (`vault login -method=userpass
username=crvouga`), OpenTofu 1.13.0, and the crvouga Vault password (the root's
`admin_passwords` input; obtain it through the T3 secret prompt, never chat).
Keep every generated input under the gitignored scratch area, mode 0600, and
delete it afterwards. Never print values.

1. **Build the complete `vault_inputs`.** `secrets.dev` = every field of current
   `personal/dev`; `secrets.prd` = every field of current `personal/prd` plus the
   four fields read from `-version=147`; `admin_passwords` = `{ "crvouga": … }`.
   Managed/derived fields may stay; the root overrides them. Validate with
   `TF_VAR_vault_inputs="$(cat FILE)" bun run check:vault-inputs`.
2. **Foundation (updates `TOFU_VAULT_INPUTS`).** Read
   `secret/infra/operator` for state credentials, Cloudflare account/zone and
   GitHub token; `personal/prd` for `RAILWAY_TOKEN`, `CLOUDFLARE_API_TOKEN`,
   `PLANETSCALE_SERVICE_TOKEN_ID`, `PLANETSCALE_SERVICE_TOKEN`. Export them as
   `TF_VAR_*` with `TF_VAR_vault_inputs`, then `bun run infra plan
-out=...`. **Accept only** an in-place update of
   `github_actions_secret.bootstrap["TOFU_VAULT_INPUTS"]`. Any other change means
   a rebuilt input differs from the deployed one: stop and ask the operator.
   Apply that saved plan.
3. **Vault root.** Same state credentials plus `TF_VAR_state_passphrase`,
   `TF_VAR_cloudflare_account_id`, `TF_VAR_state_access_key`,
   `TF_VAR_state_secret_key`, `TF_VAR_github_token`, `TF_VAR_cloudflare_zone_id`,
   and the same `secrets`/`admin_passwords` (as `inputs.auto.tfvars.json`, as CI
   does). `bun run infra:vault plan -out=...`. **Accept only** an in-place update
   of `vault_kv_secret_v2.personal["prd"]` that adds the four fields. Apply that
   saved plan with `-parallelism=1`.
4. **Verify** `vault kv get -field=CLIPROXY_FLEET_CLIENT_API_KEY
secret/personal/prd` exits 0 (discard output), the next **CLI proxy health
   schedule** run passes, then run **Fleet: Sync**.
5. Merge this branch through the normal PR/Check flow.
