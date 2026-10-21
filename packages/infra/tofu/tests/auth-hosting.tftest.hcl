mock_provider "railway" {
  mock_resource "railway_service" {
    defaults = { id = "44444444-4444-4444-8444-444444444444" }
  }
}
mock_provider "graphql" {}
mock_provider "cloudflare" {}
mock_provider "vault" {
  mock_data "vault_kv_secret_v2" {
    defaults = {
      data = {
        AUTH_CONSOLE_CLIENT_ID               = "console-id"
        AUTH_CONSOLE_CLIENT_SECRET           = "console-secret"
        AUTH_MANAGER_CLIENT_ID               = "manager-id"
        AUTH_MANAGER_CLIENT_SECRET           = "manager-secret"
        AUTH_RELAY_DATABASE_URL              = "postgres://console:secret@db.example.net/app"
        AUTH_RELAY_SETUP_TOKEN_PRODUCTION    = "setup-prd"
        AUTH_RELAY_SETUP_TOKEN_NONPRODUCTION = "setup-dev"
      }
    }
  }
}

override_data {
  target = data.terraform_remote_state.foundation
  values = {
    outputs = {
      project_id     = "11111111-1111-4111-8111-111111111111"
      environment_id = "22222222-2222-4222-8222-222222222222"
      zone_id        = "33333333333333333333333333333333"
      auth_relay_database = {
        production    = { KC_DB_URL = "jdbc:postgresql://db/app", KC_DB_USERNAME = "u", KC_DB_PASSWORD = "p", KC_DB_SCHEMA = "auth_production" }
        nonproduction = { KC_DB_URL = "jdbc:postgresql://db/app", KC_DB_USERNAME = "u", KC_DB_PASSWORD = "p", KC_DB_SCHEMA = "auth_nonproduction" }
      }
      auth_admin = {
        production    = { username = "admin", password = "pw", tunnel_token = "tunnel" }
        nonproduction = { username = "admin", password = "pw", tunnel_token = "tunnel" }
      }
    }
  }
}

variables {
  state_backend = {
    bucket                      = "test-state"
    region                      = "auto"
    skip_credentials_validation = true
    skip_region_validation      = true
    skip_requesting_account_id  = true
    skip_metadata_api_check     = true
  }
  railway_token        = "railway"
  cloudflare_api_token = "cloudflare"
  image                = "ghcr.io/crvouga/chrisvouga-auth-relay@sha256:1111111111111111111111111111111111111111111111111111111111111111"
  keycloak_image       = "ghcr.io/crvouga/chrisvouga-auth-relay-identity@sha256:2222222222222222222222222222222222222222222222222222222222222222"
  tunnel_image         = "ghcr.io/crvouga/chrisvouga-auth-relay-tunnel@sha256:3333333333333333333333333333333333333333333333333333333333333333"
}

run "gateway_is_deployed_for_every_instance_once_live" {
  command = plan
  assert {
    condition     = toset(keys(module.broker)) == toset(["production", "nonproduction"])
    error_message = "A live relay needs a public gateway (and so its custom domain) per instance."
  }
}

run "gateway_waits_for_projected_credentials" {
  command = plan
  variables { deploy_gateway = false }
  assert {
    condition     = length(module.broker) == 0 && toset(keys(module.identity)) == toset(["production", "nonproduction"])
    error_message = "Deferring the gateway must still deploy the private identity services."
  }
}
