module "inventory" { source = "../modules/inventory" }
locals {
  config = module.inventory.config
  services = {
    for service in local.config.services : service.id => service
    if try(service.kind, "railway") == "railway" && !try(service.standalone, false)
  }
  service_instances = { for id, service in local.services : try(service.state_key, id) => service if !try(service.internal, false) }
  # Reachable only on the private network: no custom domain and no DNS record.
  internal_service_instances = { for id, service in local.services : try(service.state_key, id) => service if try(service.internal, false) }
  vault_addr                 = "https://${local.config.vault.hostname}"
  # Every hosted service exports to the shared OTLP endpoint through standard
  # OpenTelemetry variables. Inert for runtimes without an OpenTelemetry SDK.
  observability = local.config.observability
  otel_enabled  = local.observability.enabled && local.observability.live && local.observability.inject_railway_services
}

data "terraform_remote_state" "foundation" {
  backend = "s3"
  config  = merge(var.state_backend, { key = "foundation.tfstate" })
}

data "terraform_remote_state" "bootstrap" {
  backend = "s3"
  config  = merge(var.state_backend, { key = "bootstrap.tfstate" })
}

data "vault_kv_secret_v2" "production" {
  mount = local.config.vault.kv.mount
  name  = "${local.config.vault.kv.project}/prd"
}

locals {
  service_variables = { for key, service in merge(local.service_instances, local.internal_service_instances) : key => merge(
    { for name, value in try(service.env, {}) : name => lookup({
      from_vault_addr         = local.vault_addr
      "from_vault.kv.project" = local.config.vault.kv.project
    }, value, value) },
    { for secret in try(service.secrets, []) : secret.name => data.vault_kv_secret_v2.production.data[try(secret.vault_key, secret.name)] },
    local.otel_enabled && try(service.observability, true) ? {
      OTEL_SERVICE_NAME           = service.id
      OTEL_EXPORTER_OTLP_ENDPOINT = data.vault_kv_secret_v2.production.data["OTEL_EXPORTER_OTLP_ENDPOINT"]
      OTEL_EXPORTER_OTLP_HEADERS  = data.vault_kv_secret_v2.production.data["OTEL_EXPORTER_OTLP_HEADERS"]
      OTEL_EXPORTER_OTLP_PROTOCOL = "http/protobuf"
      OTEL_RESOURCE_ATTRIBUTES    = data.vault_kv_secret_v2.production.data["OTEL_RESOURCE_ATTRIBUTES"]
    } : {}
  ) }
  service_images = { for key, service in merge(local.service_instances, local.internal_service_instances) : key =>
    try(service.image, "ghcr.io/${local.config.image_owner}/${local.config.image_prefix}-${service.id}:${lookup(var.image_tags, service.id, local.config.default_image_tag)}")
  }
}

module "service" {
  for_each          = local.service_instances
  source            = "../modules/railway-service"
  project_id        = data.terraform_remote_state.foundation.outputs.project_id
  environment_id    = data.terraform_remote_state.foundation.outputs.environment_id
  zone_id           = data.terraform_remote_state.foundation.outputs.zone_id
  region            = local.config.railway.region
  service           = each.value
  image             = local.service_images[each.key]
  registry_password = try(data.vault_kv_secret_v2.production.data[each.value.railway.registry.vault_key], null)
  variables         = local.service_variables[each.key]
}

module "internal_service" {
  for_each       = local.internal_service_instances
  source         = "../modules/railway-internal-service"
  project_id     = data.terraform_remote_state.foundation.outputs.project_id
  environment_id = data.terraform_remote_state.foundation.outputs.environment_id
  region         = local.config.railway.region
  service        = each.value
  image          = local.service_images[each.key]
  variables      = local.service_variables[each.key]
}

output "service_ids" {
  value = merge(
    { for key, service in module.service : local.service_instances[key].id => service.id },
    { for key, service in module.internal_service : local.internal_service_instances[key].id => service.id }
  )
}
output "image_tags" { value = { for id, service in local.services : id => lookup(var.image_tags, id, local.config.default_image_tag) } }
