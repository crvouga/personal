# Administrative CLI access lives outside personal/*: application and CI read
# tokens must never obtain state decryption material or deployment credentials.
variable "state_access_key" {
  type      = string
  sensitive = true
  default   = ""
}
variable "state_secret_key" {
  type      = string
  sensitive = true
  default   = ""
}
variable "github_token" {
  type      = string
  sensitive = true
  default   = ""
}
variable "cloudflare_zone_id" {
  type    = string
  default = ""
}

resource "vault_kv_secret_v2" "operator" {
  mount = vault_mount.secret.path
  name  = local.vault.operator_credentials_path
  data_json = jsonencode({
    TOFU_STATE_PASSPHRASE = var.state_passphrase
    TOFU_STATE_ACCESS_KEY = var.state_access_key
    TOFU_STATE_SECRET_KEY = var.state_secret_key
    CLOUDFLARE_ACCOUNT_ID = var.cloudflare_account_id
    CLOUDFLARE_ZONE_ID    = var.cloudflare_zone_id
    GITHUB_TOKEN          = var.github_token
  })
  lifecycle {
    prevent_destroy = true
    precondition {
      condition     = alltrue([for value in [var.state_access_key, var.state_secret_key, var.github_token, var.cloudflare_zone_id] : trimspace(value) != ""])
      error_message = "Publish operator credentials with the existing deployment environment; state and provider credentials must not be empty."
    }
  }
}
