# The signing key was bootstrapped once through OpenTofu. Preserve the live
# isolated document during adoption; never generate a replacement on state loss.
data "vault_kv_secret_v2" "fleet_cache_signing" {
  mount = local.vault.kv.mount
  name  = "fleet-cache/publisher"
}

data "tls_public_key" "fleet_cache" {
  private_key_pem = data.vault_kv_secret_v2.fleet_cache_signing.data["NIX_CACHE_PRIVATE_KEY_PEM"]
}

resource "vault_kv_secret_v2" "fleet_cache_publisher" {
  mount = vault_mount.secret.path
  name  = "fleet-cache/publisher"
  data_json = jsonencode({
    NIX_CACHE_PRIVATE_KEY_PEM = data.vault_kv_secret_v2.fleet_cache_signing.data["NIX_CACHE_PRIVATE_KEY_PEM"]
    S3_ENDPOINT               = "https://${var.cloudflare_account_id}.r2.cloudflarestorage.com"
    S3_REGION                 = "auto"
    S3_BUCKET                 = data.terraform_remote_state.foundation.outputs.buckets.production
    S3_ACCESS_KEY_ID          = data.terraform_remote_state.foundation.outputs.r2_access_key_id
    S3_SECRET_ACCESS_KEY      = data.terraform_remote_state.foundation.outputs.r2_secret_access_key
  })
  lifecycle {
    prevent_destroy = true
    precondition {
      condition     = data.tls_public_key.fleet_cache.public_key_fingerprint_sha256 == local.config.fleet_cache.signing_key_fingerprint
      error_message = "Fleet cache signing key differs from the pinned identity. Restore the existing key; do not rotate it implicitly."
    }
  }
}

resource "vault_policy" "fleet_cache_publisher" {
  name   = "fleet-cache-publisher"
  policy = <<-HCL
    path "${vault_mount.secret.path}/data/${vault_kv_secret_v2.fleet_cache_publisher.name}" {
      capabilities = ["read"]
    }
  HCL
}

resource "vault_jwt_auth_backend_role" "fleet_cache_publisher" {
  backend           = vault_jwt_auth_backend.github.path
  role_name         = "fleet-cache-publisher"
  role_type         = "jwt"
  user_claim        = "sub"
  bound_audiences   = [local.vault_addr]
  bound_claims_type = "string"
  bound_claims = {
    repository   = local.config.github.infra_repo
    ref          = "refs/heads/main"
    workflow_ref = "${local.config.github.infra_repo}/.github/workflows/fleet-cache.yml@refs/heads/main"
  }
  token_policies          = [vault_policy.fleet_cache_publisher.name]
  token_ttl               = 600
  token_max_ttl           = 600
  token_no_default_policy = true
}

output "fleet_cache_public_key_pem" {
  description = "Public Ed25519 key only; convert to the Nix name:base64 form when pinning the cache."
  value       = data.tls_public_key.fleet_cache.public_key_pem
}
