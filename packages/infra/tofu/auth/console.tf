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
# Keycloak 26.8 treats realm-management as an internal client whose secret cannot
# be read (403), and the provider's client data source always reads the secret.
# Look up only its identifier with the admin API, using a token fetched in the
# same read so it cannot expire between the two requests.
data "http" "admin_token" {
  url    = "${local.admin.url}/realms/master/protocol/openid-connect/token"
  method = "POST"
  request_headers = {
    "Content-Type"            = "application/x-www-form-urlencoded"
    "CF-Access-Client-Id"     = local.admin.access_client_id
    "CF-Access-Client-Secret" = local.admin.access_client_secret
  }
  request_body = "grant_type=password&client_id=admin-cli&username=${urlencode(local.admin.username)}&password=${urlencode(local.admin.password)}"
  lifecycle {
    postcondition {
      condition     = self.status_code == 200
      error_message = "The Keycloak admin token request failed."
    }
  }
  depends_on = [keycloak_realm.broker]
}
data "http" "realm_management" {
  url = "${local.admin.url}/admin/realms/${keycloak_realm.broker.id}/clients?clientId=realm-management"
  request_headers = {
    "Authorization"           = "Bearer ${jsondecode(data.http.admin_token.response_body).access_token}"
    "CF-Access-Client-Id"     = local.admin.access_client_id
    "CF-Access-Client-Secret" = local.admin.access_client_secret
  }
  lifecycle {
    postcondition {
      condition     = self.status_code == 200 && length(jsondecode(self.response_body)) == 1
      error_message = "The realm-management client was not found."
    }
  }
}
locals { realm_management_id = jsondecode(data.http.realm_management.response_body)[0].id }
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
