# Only the relay's two system identities are bootstrapped in infrastructure.
# Consuming application registrations are exclusively operator-owned DB data.
resource "keycloak_openid_client" "console" {
  realm_id                     = keycloak_realm.broker.id
  client_id                    = "auth-relay-console"
  name                         = "Authentication relay administration"
  access_type                  = "CONFIDENTIAL"
  standard_flow_enabled        = true
  implicit_flow_enabled        = false
  direct_access_grants_enabled = false
  valid_redirect_uris          = ["https://${local.broker.hostname}/auth/callback"]
  web_origins                  = ["https://${local.broker.hostname}"]
  pkce_code_challenge_method   = "S256"
}
resource "keycloak_openid_client" "manager" {
  realm_id                     = keycloak_realm.broker.id
  client_id                    = "auth-relay-registration"
  access_type                  = "CONFIDENTIAL"
  standard_flow_enabled        = false
  direct_access_grants_enabled = false
  service_accounts_enabled     = true
}
# Keycloak 26.8 refuses to return realm-management's secret, which the provider's
# client data source always reads, so only its identifier is looked up.
module "realm_management" {
  source     = "../modules/auth-realm-management"
  admin      = local.admin
  realm_id   = keycloak_realm.broker.id
  depends_on = [keycloak_realm.broker]
}
locals { realm_management_id = module.realm_management.id }
resource "keycloak_openid_client_service_account_role" "registration" {
  realm_id                = keycloak_realm.broker.id
  service_account_user_id = keycloak_openid_client.manager.service_account_user_id
  client_id               = local.realm_management_id
  role                    = "manage-clients"
}
output "console_credentials" {
  sensitive = true
  value = {
    AUTH_CONSOLE_CLIENT_ID     = keycloak_openid_client.console.client_id
    AUTH_CONSOLE_CLIENT_SECRET = keycloak_openid_client.console.client_secret
    AUTH_MANAGER_CLIENT_ID     = keycloak_openid_client.manager.client_id
    AUTH_MANAGER_CLIENT_SECRET = keycloak_openid_client.manager.client_secret
  }
}
