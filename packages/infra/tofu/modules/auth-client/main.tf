# Disposable compatibility-fixture client only. Production consuming clients
# are registered by the Hono UI/API and stored in its isolated schema.
terraform {
  required_providers {
    keycloak = { source = "keycloak/keycloak", version = "= 5.9.0" }
  }
}
variable "realm_id" { type = string }
variable "client_id" { type = string }
variable "redirect_uris" {
  type = set(string)
  validation {
    condition = length(var.redirect_uris) > 0 && length(var.redirect_uris) <= 8 && alltrue([
      for uri in var.redirect_uris : length(uri) <= 2048 && !can(regex("[\\*#%@?\\\\]", uri)) && !can(regex("/[.][.](/|$)", uri)) &&
      try(tonumber(regex(":([0-9]+)/", uri)[0]) >= 1 && tonumber(regex(":([0-9]+)/", uri)[0]) <= 65535, !can(regex(":([0-9]+)/", uri))) &&
      can(regex("^(https://[a-z0-9][a-z0-9.-]*(:[0-9]+)?|http://(localhost|127[.]0[.]0[.]1):[0-9]+)/[A-Za-z0-9/_~.-]+$", uri))
    ])
    error_message = "Supply 1–8 exact HTTPS callbacks or explicit-port HTTP localhost/127.0.0.1 callbacks, without userinfo, query, fragment, escapes or wildcards."
  }
}
variable "enabled" { type = bool }
resource "keycloak_openid_client" "this" {
  realm_id                        = var.realm_id
  client_id                       = var.client_id
  enabled                         = var.enabled
  access_type                     = "PUBLIC"
  standard_flow_enabled           = true
  implicit_flow_enabled           = false
  direct_access_grants_enabled    = false
  service_accounts_enabled        = false
  pkce_code_challenge_method      = "S256"
  valid_redirect_uris             = var.redirect_uris
  valid_post_logout_redirect_uris = []
  web_origins                     = distinct([for uri in var.redirect_uris : regex("^https?://[^/]+", uri)])
  full_scope_allowed              = false
  use_refresh_tokens              = false
  access_token_lifespan           = 300
  # Every web application, including SSR/BFF, uses code + PKCE. No shared
  # client secrets or native-app loopback port exceptions are needed.
}
output "client_id" { value = keycloak_openid_client.this.client_id }
