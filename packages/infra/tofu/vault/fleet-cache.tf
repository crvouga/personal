# A cloud-hosted signed cache is independent of every physical Fleet node.
# This key is generated only by OpenTofu and persists in encrypted state and an
# isolated Vault document. Runtime services receive no signing credential.
resource "tls_private_key" "fleet_cache" {
  algorithm = "ED25519"
  lifecycle { prevent_destroy = true }
}

resource "vault_kv_secret_v2" "fleet_cache_publisher" {
  mount = vault_mount.secret.path
  name  = "fleet-cache/publisher"
  data_json = jsonencode({
    NIX_CACHE_PRIVATE_KEY_PEM = tls_private_key.fleet_cache.private_key_pem_pkcs8
    S3_ENDPOINT               = "https://${var.cloudflare_account_id}.r2.cloudflarestorage.com"
    S3_REGION                 = "auto"
    S3_BUCKET                 = data.terraform_remote_state.foundation.outputs.buckets.production
    S3_ACCESS_KEY_ID          = data.terraform_remote_state.foundation.outputs.r2_access_key_id
    S3_SECRET_ACCESS_KEY      = data.terraform_remote_state.foundation.outputs.r2_secret_access_key
  })
  lifecycle { prevent_destroy = true }
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
  value       = tls_private_key.fleet_cache.public_key_pem
}
