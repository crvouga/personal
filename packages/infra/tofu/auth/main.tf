module "inventory" { source = "../modules/inventory" }
variable "instance" {
  type = string
  validation {
    condition     = contains(["production", "nonproduction"], var.instance)
    error_message = "Use production or nonproduction, each with independent state and server credentials."
  }
}
locals { broker = module.inventory.config.auth_relay.instances[var.instance] }
data "vault_kv_secret_v2" "google" {
  mount = module.inventory.config.vault.kv.mount
  name  = "${module.inventory.config.vault.kv.project}/${local.broker.vault_config}"
}
resource "keycloak_realm" "broker" {
  internal_id                = local.broker.realm
  realm                      = local.broker.realm
  enabled                    = true
  registration_allowed       = false
  reset_password_allowed     = false
  edit_username_allowed      = false
  duplicate_emails_allowed   = false
  ssl_required               = "all"
  access_code_lifespan       = "1m"
  access_code_lifespan_login = "10m"
  access_token_lifespan      = "5m"
  sso_session_idle_timeout   = "30m"
  sso_session_max_lifespan   = "8h"
  revoke_refresh_token       = true
  refresh_token_max_reuse    = 0
  lifecycle { prevent_destroy = true }
}
resource "keycloak_oidc_google_identity_provider" "google" {
  realm          = keycloak_realm.broker.id
  alias          = "google"
  client_id      = data.vault_kv_secret_v2.google.data[local.broker.google_client_id_key]
  client_secret  = data.vault_kv_secret_v2.google.data[local.broker.google_client_secret_key]
  default_scopes = "openid email profile"
  store_token    = false
  # Preserve Google's verified-email assertion for email-based application access.
  # This does not auto-link accounts; the confirmation flow below remains intact.
  trust_email = true
  # Keep the built-in first-broker-login confirmation flow. Never auto-link
  # existing accounts by email or expose Google access/refresh tokens to apps.
}
output "issuer" { value = "https://${local.broker.hostname}/realms/${keycloak_realm.broker.realm}" }
output "google_callback" { value = "https://${local.broker.hostname}/realms/${keycloak_realm.broker.realm}/broker/google/endpoint" }

module "signing_keys" {
  source      = "../modules/auth-signing-keys"
  realm_id    = keycloak_realm.broker.id
  generations = local.broker.signing_key_generations
}
