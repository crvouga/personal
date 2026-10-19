module "inventory" { source = "../modules/inventory" }
variable "state_passphrase" {
  type      = string
  sensitive = true
}
variable "state_backend" { type = any }
variable "railway_token" {
  type      = string
  sensitive = true
}
variable "cloudflare_api_token" {
  type      = string
  sensitive = true
}
variable "image" {
  type        = string
  description = "Reviewed immutable GHCR image digest, never latest."
  validation {
    condition     = can(regex("^ghcr.io/[a-z0-9/._-]+@sha256:[a-f0-9]{64}$", var.image))
    error_message = "Use a pinned public GHCR digest."
  }
}
provider "railway" { token = var.railway_token }
provider "graphql" {
  url     = "https://backboard.railway.app/graphql/v2"
  headers = { Authorization = "Bearer ${var.railway_token}" }
}
provider "cloudflare" { api_token = var.cloudflare_api_token }
data "terraform_remote_state" "foundation" {
  backend = "s3"
  config  = merge(var.state_backend, { key = "foundation.tfstate" })
}
# The private identity service and its tunnel connector deploy as soon as the
# relay is enabled. The public gateway needs the realm's system credentials in
# Vault, so it follows only once the inventory marks the relay live.
locals {
  instances        = module.inventory.config.auth_relay.enabled ? module.inventory.config.auth_relay.instances : {}
  broker_instances = module.inventory.config.auth_relay.live ? local.instances : {}
}
variable "tunnel_image" {
  type = string
  validation {
    condition     = can(regex("^ghcr.io/[a-z0-9/._-]+@sha256:[a-f0-9]{64}$", var.tunnel_image))
    error_message = "Use an immutable public GHCR digest for the tunnel connector."
  }
}
variable "keycloak_schema_init" {
  type        = bool
  default     = false
  description = "Let Keycloak create its tables in an empty schema. Set only for the first apply of an instance; the default validates the existing schema."
}
variable "keycloak_image" {
  type = string
  validation {
    condition     = can(regex("^ghcr.io/[a-z0-9/._-]+@sha256:[a-f0-9]{64}$", var.keycloak_image))
    error_message = "Use an immutable Keycloak image digest."
  }
}
provider "vault" { address = "https://${module.inventory.config.vault.hostname}" }
data "vault_kv_secret_v2" "console" {
  for_each = local.broker_instances
  mount    = module.inventory.config.vault.kv.mount
  name     = "${module.inventory.config.vault.kv.project}/${each.value.vault_config}"
}
module "identity" {
  for_each       = local.instances
  source         = "../modules/auth-identity-service"
  project_id     = data.terraform_remote_state.foundation.outputs.project_id
  environment_id = data.terraform_remote_state.foundation.outputs.environment_id
  region         = module.inventory.config.railway.region
  service        = { id = "${each.value.service.id}-identity", health_path = "/health/ready", railway = { sleep = false, replicas = 2 } }
  image          = var.keycloak_image
  variables = merge(data.terraform_remote_state.foundation.outputs.auth_relay_database[each.key], {
    KC_BOOTSTRAP_ADMIN_USERNAME                         = data.terraform_remote_state.foundation.outputs.auth_admin[each.key].username
    KC_BOOTSTRAP_ADMIN_PASSWORD                         = data.terraform_remote_state.foundation.outputs.auth_admin[each.key].password
    KC_HOSTNAME                                         = "https://${each.value.hostname}"
    KC_HTTP_HOST                                        = "::"
    KC_PROXY_HEADERS                                    = "xforwarded"
    KC_HTTP_MANAGEMENT_HEALTH_ENABLED                   = "false"
    KC_SPI_CONNECTIONS_JPA__QUARKUS__MIGRATION_STRATEGY = var.keycloak_schema_init ? "update" : "validate"
    KC_SPI_CONNECTIONS_JPA__QUARKUS__INITIALIZE_EMPTY   = var.keycloak_schema_init ? "true" : "false"
    RAILWAY_DEPLOYMENT_OVERLAP_SECONDS                  = "60"
    RAILWAY_DEPLOYMENT_DRAINING_SECONDS                 = "60"
  })
}
# Outbound-only Cloudflare Tunnel connector. It is the single path to the
# identity service's admin API, and Access admits only the CI service token.
module "admin_connector" {
  for_each       = local.instances
  source         = "../modules/auth-identity-service"
  project_id     = data.terraform_remote_state.foundation.outputs.project_id
  environment_id = data.terraform_remote_state.foundation.outputs.environment_id
  region         = module.inventory.config.railway.region
  service        = { id = "${each.value.service.id}-admin-tunnel", railway = { sleep = false, replicas = 2, health_check = false } }
  image          = var.tunnel_image
  variables      = { TUNNEL_TOKEN = data.terraform_remote_state.foundation.outputs.auth_admin[each.key].tunnel_token }
}
module "broker" {
  for_each       = local.broker_instances
  source         = "../modules/railway-service"
  project_id     = data.terraform_remote_state.foundation.outputs.project_id
  environment_id = data.terraform_remote_state.foundation.outputs.environment_id
  zone_id        = data.terraform_remote_state.foundation.outputs.zone_id
  region         = module.inventory.config.railway.region
  service        = each.value.service
  image          = var.image
  variables = merge(each.value.service.env, { for key in ["AUTH_CONSOLE_CLIENT_ID", "AUTH_CONSOLE_CLIENT_SECRET", "AUTH_MANAGER_CLIENT_ID", "AUTH_MANAGER_CLIENT_SECRET"] : key => data.vault_kv_secret_v2.console[each.key].data[key] }, {
    AUTH_ORIGIN       = "https://${each.value.hostname}"
    AUTH_REALM        = each.value.realm
    AUTH_ENVIRONMENT  = each.key
    AUTH_DATABASE_URL = data.vault_kv_secret_v2.console[each.key].data["AUTH_RELAY_DATABASE_URL"]
    AUTH_UPSTREAM     = "http://${each.value.service.id}-identity.railway.internal:8080"
    AUTH_SETUP_TOKEN  = data.vault_kv_secret_v2.console[each.key].data[each.value.setup_token_key]
  })
  depends_on = [module.identity]
}
output "service_ids" { value = { for id, service in module.broker : id => service.id } }
