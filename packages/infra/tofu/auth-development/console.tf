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
  valid_redirect_uris          = ["${local.origin}/auth/callback"]
  web_origins                  = ["${local.origin}"]
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
# The pinned client data source requests a secret even for Keycloak's built-in
# bearer-only realm-management client (403). Read only its ID through the
# official admin endpoint instead; do not change the built-in client or patch
# the provider. All credential exchange and lookup stays inside OpenTofu.
provider "http" {}
data "http" "admin_token" {
  url             = "http://127.0.0.1:${var.broker_port}/realms/master/protocol/openid-connect/token"
  method          = "POST"
  request_headers = { "Content-Type" = "application/x-www-form-urlencoded" }
  request_body    = "grant_type=password&client_id=admin-cli&username=admin&password=development-only"
}
data "http" "management_client" {
  url             = "http://127.0.0.1:${var.broker_port}/admin/realms/${keycloak_realm.broker.realm}/clients?clientId=realm-management"
  request_headers = { Authorization = sensitive("Bearer ${jsondecode(data.http.admin_token.response_body).access_token}") }
  lifecycle {
    postcondition {
      condition     = length(jsondecode(self.response_body)) == 1
      error_message = "Exactly one built-in realm-management client is required."
    }
  }
}
resource "keycloak_openid_client_service_account_role" "registration" {
  realm_id                = keycloak_realm.broker.id
  service_account_user_id = keycloak_openid_client.manager.service_account_user_id
  client_id               = jsondecode(data.http.management_client.response_body)[0].id
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

output "development_environment" {
  sensitive = true
  value = merge({
    AUTH_ORIGIN       = local.origin
    AUTH_UPSTREAM     = "http://127.0.0.1:${var.broker_port}"
    AUTH_ENVIRONMENT  = "nonproduction"
    AUTH_REALM        = keycloak_realm.broker.realm
    AUTH_DATABASE_URL = local.database_url
    AUTH_SETUP_TOKEN  = "local-development-only"
    }, {
    AUTH_CONSOLE_CLIENT_ID     = keycloak_openid_client.console.client_id
    AUTH_CONSOLE_CLIENT_SECRET = keycloak_openid_client.console.client_secret
    AUTH_MANAGER_CLIENT_ID     = keycloak_openid_client.manager.client_id
    AUTH_MANAGER_CLIENT_SECRET = keycloak_openid_client.manager.client_secret
  })
}
