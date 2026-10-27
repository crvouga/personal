module "inventory" { source = "../modules/inventory" }
locals {
  config = module.inventory.config
  services = {
    for service in local.config.services : service.id => service
    if try(service.kind, "railway") == "railway" && !try(service.standalone, false)
  }
  vault_addr = "https://${local.config.vault.hostname}"
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

module "service" {
  for_each          = local.services
  source            = "../modules/railway-service"
  project_id        = data.terraform_remote_state.foundation.outputs.project_id
  environment_id    = data.terraform_remote_state.foundation.outputs.environment_id
  zone_id           = data.terraform_remote_state.foundation.outputs.zone_id
  region            = local.config.railway.region
  service           = each.value
  image             = try(each.value.image, "ghcr.io/${local.config.image_owner}/${local.config.image_prefix}-${each.key}:${lookup(var.image_tags, each.key, local.config.default_image_tag)}")
  registry_password = try(data.vault_kv_secret_v2.production.data[each.value.railway.registry.vault_key], null)
  variables = merge(
    { for name, value in try(each.value.env, {}) : name => lookup({
      from_vault_addr         = local.vault_addr
      "from_vault.kv.project" = local.config.vault.kv.project
    }, value, value) },
    { for secret in try(each.value.secrets, []) : secret.name => data.vault_kv_secret_v2.production.data[secret.name] }
  )
}

output "service_ids" { value = { for id, service in module.service : id => service.id } }
output "image_tags" { value = { for id, service in local.services : id => lookup(var.image_tags, id, local.config.default_image_tag) } }
