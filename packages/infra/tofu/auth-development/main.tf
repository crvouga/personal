# Loopback-only developer fixture. Never connects to a managed database or Vault.
terraform {
  required_version = "~> 1.13.0"
  required_providers {
    postgresql = { source = "cyrilgdn/postgresql", version = "= 1.26.0" }
    atlas      = { source = "ariga/atlas", version = "= 0.10.3" }
    keycloak   = { source = "keycloak/keycloak", version = "= 5.9.0" }
    http       = { source = "hashicorp/http", version = "= 3.5.0" }
  }
  backend "local" {}
  encryption {
    key_provider "pbkdf2" "local" { passphrase = var.state_passphrase }
    method "aes_gcm" "local" { keys = key_provider.pbkdf2.local }
    state {
      method   = method.aes_gcm.local
      enforced = true
    }
    plan {
      method   = method.aes_gcm.local
      enforced = true
    }
  }
}
variable "state_passphrase" {
  type      = string
  sensitive = true
}
variable "database_port" { type = number }
variable "broker_port" { type = number }
variable "mock_port" { type = number }
variable "app_port" { type = number }
# Atlas connects to the scratch database while planning, so the first run
# creates the PostgreSQL scaffolding with this disabled and then enables it.
variable "atlas_enabled" {
  type    = bool
  default = true
}
locals {
  database_url = "postgres://development:development-only@127.0.0.1:${var.database_port}/auth_relay_development?sslmode=disable"
  origin       = "http://localhost:${var.app_port}"
}
provider "postgresql" {
  host      = "127.0.0.1"
  port      = var.database_port
  database  = "auth_relay_development"
  username  = "development"
  password  = "development-only"
  sslmode   = "disable"
  superuser = false
}
provider "atlas" {}
provider "keycloak" {
  url       = "http://127.0.0.1:${var.broker_port}"
  client_id = "admin-cli"
  username  = "admin"
  password  = "development-only"
  realm     = "master"
}
resource "postgresql_schema" "console" { name = "auth_relay_nonproduction" }
resource "postgresql_database" "scratch" { name = "auth_relay_atlas_scratch" }
resource "postgresql_schema" "scratch" {
  database      = postgresql_database.scratch.name
  name          = "auth_relay_nonproduction"
  if_not_exists = true
}
moved {
  from = atlas_schema.console
  to   = atlas_schema.console[0]
}
resource "atlas_schema" "console" {
  count      = var.atlas_enabled ? 1 : 0
  url        = "${local.database_url}&search_path=auth_relay_nonproduction"
  dev_url    = "postgres://development:development-only@127.0.0.1:${var.database_port}/auth_relay_atlas_scratch?sslmode=disable&search_path=auth_relay_nonproduction"
  hcl        = templatefile("${path.module}/../../../auth-relay/schema.hcl", { schema = "auth_relay_nonproduction" })
  depends_on = [postgresql_schema.console, postgresql_schema.scratch]
}
resource "keycloak_realm" "broker" {
  internal_id          = "local-development"
  realm                = "local-development"
  enabled              = true
  registration_allowed = false
  ssl_required         = "none"
}
resource "keycloak_oidc_identity_provider" "mock" {
  realm              = keycloak_realm.broker.id
  alias              = "google"
  display_name       = "LOCAL TEST IDENTITY (not Google)"
  client_id          = "mock-broker"
  client_secret      = "development-only"
  authorization_url  = "http://localhost:${var.mock_port}/authorize"
  token_url          = "http://mock:8090/token"
  jwks_url           = "http://mock:8090/jwks"
  issuer             = "http://mock:8090"
  validate_signature = true
  disable_user_info  = true
  default_scopes     = "openid email profile"
  extra_config = {
    prompt = "select_account"
  }
  trust_email = true
  store_token = false
}
