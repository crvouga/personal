module "inventory" { source = "../modules/inventory" }
locals {
  config     = module.inventory.config
  vault      = one([for service in local.config.services : service if service.id == "vault"])
  vault_addr = "https://${local.config.vault.hostname}"
  postgres   = one(local.config.postgres.projects)
}

resource "cloudflare_zone" "primary" {
  account = { id = var.cloudflare_account_id }
  name    = local.config.zone
  type    = "full"
  lifecycle { prevent_destroy = true }
}

resource "railway_project" "workspace" {
  name                = local.config.railway.project
  default_environment = { name = local.config.railway.environment }
  lifecycle { prevent_destroy = true }
}

# The published provider creates the database with the branch and reports
# replicas; it cannot send a replica count. Reject anything but the inventory
# single-node count before credentials are published.
resource "planetscale_postgres_branch" "openbao" {
  organization  = local.postgres.organization
  database      = local.postgres.name
  name          = local.postgres.branch
  region        = local.postgres.region
  cluster_size  = local.postgres.cluster_size
  major_version = local.postgres.major_version
  lifecycle {
    prevent_destroy = true
    postcondition {
      condition     = self.replicas == local.postgres.replicas
      error_message = "The branch replica count must match inventory. The published provider cannot set it, so resize the branch to the inventory count before any credential is published."
    }
  }
}

resource "planetscale_postgres_branch_role" "openbao" {
  organization    = local.postgres.organization
  database        = local.postgres.name
  branch          = planetscale_postgres_branch.openbao.name
  name            = local.postgres.role_name
  inherited_roles = local.postgres.inherited_roles
  lifecycle {
    postcondition {
      condition     = !strcontains(self.access_host_url, "://") && !strcontains(self.access_host_url, "/")
      error_message = "PlanetScale access_host_url must be a host so the connection URI can be assembled."
    }
  }
}

resource "cloudflare_dns_record" "additional" {
  for_each = local.config.cloudflare.dns.records
  zone_id  = cloudflare_zone.primary.id
  name     = each.value.name
  type     = each.value.type
  content  = each.value.content
  ttl      = each.value.ttl
  proxied  = each.value.proxied
  priority = try(each.value.priority, null)
  lifecycle { prevent_destroy = true }
}

resource "cloudflare_zero_trust_tunnel_cloudflared" "additional" {
  for_each   = local.config.cloudflare.additional_tunnels
  account_id = var.cloudflare_account_id
  name       = each.value.name
  config_src = "cloudflare"
  lifecycle { prevent_destroy = true }
}
resource "cloudflare_zero_trust_tunnel_cloudflared_config" "additional" {
  for_each   = local.config.cloudflare.additional_tunnels
  account_id = var.cloudflare_account_id
  tunnel_id  = cloudflare_zero_trust_tunnel_cloudflared.additional[each.key].id
  config     = each.value.config
}

module "vault_service" {
  source         = "../modules/railway-service"
  project_id     = railway_project.workspace.id
  environment_id = railway_project.workspace.default_environment.id
  zone_id        = cloudflare_zone.primary.id
  region         = local.config.railway.region
  service        = local.vault
  image          = "ghcr.io/${local.config.image_owner}/${local.config.image_prefix}-vault:${var.vault_image_tag}"
  depends_on     = [atlas_schema.openbao]
  variables = {
    DB_CONNECTION_URI = local.database_url
    BAO_API_ADDR      = local.vault_addr
    PORT              = local.vault.env.PORT
  }
}

# Railway's provider returns when a redeploy is queued. Let the new OpenBao
# process start before the next root checks its seal and submits shares.
resource "time_sleep" "vault_start" {
  create_duration = "90s"
  triggers = {
    image    = var.vault_image_tag
    service  = sha256(jsonencode(local.vault))
    database = sha256(local.database_url)
  }
  depends_on = [module.vault_service]
}

resource "cloudflare_zone_setting" "managed" {
  for_each   = local.config.cloudflare.zone_settings
  zone_id    = cloudflare_zone.primary.id
  setting_id = each.key
  value      = each.value
}

moved {
  from = cloudflare_zone_setting.ssl
  to   = cloudflare_zone_setting.managed["ssl"]
}

import {
  for_each = { for name, value in local.config.cloudflare.zone_settings : name => value if name != "ssl" }
  to       = cloudflare_zone_setting.managed[each.key]
  id       = "${var.cloudflare_zone_id}/${each.key}"
}

# SOA and NS TTL customizations require Enterprise entitlement. Leave the
# Cloudflare defaults unconfigured so adoption can run on this account.
resource "cloudflare_zone_dns_settings" "primary" {
  zone_id             = cloudflare_zone.primary.id
  flatten_all_cnames  = local.config.cloudflare.dns_settings.flatten_all_cnames
  multi_provider      = local.config.cloudflare.dns_settings.multi_provider
  nameservers         = local.config.cloudflare.dns_settings.nameservers
  secondary_overrides = local.config.cloudflare.dns_settings.secondary_overrides
  zone_mode           = local.config.cloudflare.dns_settings.zone_mode

  lifecycle {
    # The provider reads these defaults into state. Leave the account NS TTL
    # and Foundation DNS unconfigured.
    ignore_changes = [ns_ttl, foundation_dns]
  }
}

resource "cloudflare_nel_setting" "primary" {
  zone_id = cloudflare_zone.primary.id
  value   = { enabled = local.config.cloudflare.network_error_logging }
}

resource "cloudflare_zone_dnssec" "primary" {
  zone_id = cloudflare_zone.primary.id
  status  = local.config.cloudflare.dnssec_status
}

# Cloudflare 5.26.0 has no importer for zone DNS settings. Its Create method
# edits the existing zone's singleton settings, adopting them without a new zone.

import {
  to = cloudflare_nel_setting.primary
  id = var.cloudflare_zone_id
}

import {
  to = cloudflare_zone_dnssec.primary
  id = var.cloudflare_zone_id
}

resource "cloudflare_r2_bucket" "shared" {
  for_each   = { for store in local.config.object_stores : store.id => store }
  account_id = var.cloudflare_account_id
  name       = each.value.bucket
  lifecycle { prevent_destroy = true }
}

data "cloudflare_api_token_permission_groups_list" "r2" {
  name = "Workers R2 Storage Bucket Item Write"
}
resource "cloudflare_account_token" "r2" {
  account_id = var.cloudflare_account_id
  name       = "workspace-object-store"
  policies = [{
    effect            = "allow"
    permission_groups = [{ id = one(data.cloudflare_api_token_permission_groups_list.r2.result).id }]
    resources = jsonencode({ for bucket in cloudflare_r2_bucket.shared :
      "com.cloudflare.edge.r2.bucket.${var.cloudflare_account_id}_default_${bucket.name}" => "*"
    })
  }]
}

resource "random_password" "router_tunnel" {
  length  = 64
  special = false
}
resource "cloudflare_zero_trust_tunnel_cloudflared" "router" {
  account_id    = var.cloudflare_account_id
  name          = one(local.config.tunnels).name
  tunnel_secret = base64encode(random_password.router_tunnel.result)
  lifecycle { prevent_destroy = true }
}

resource "cloudflare_zero_trust_tunnel_cloudflared_config" "router" {
  account_id = var.cloudflare_account_id
  tunnel_id  = cloudflare_zero_trust_tunnel_cloudflared.router.id
  config = {
    ingress = [
      { hostname = one(local.config.tunnels).hostname, service = "http://${one(local.config.tunnels).local.host}:${one(local.config.tunnels).local.port}" },
      { service = "http_status:404" }
    ]
  }
}

resource "cloudflare_dns_record" "router" {
  zone_id = cloudflare_zone.primary.id
  name    = one(local.config.tunnels).hostname
  type    = "CNAME"
  content = "${cloudflare_zero_trust_tunnel_cloudflared.router.id}.cfargotunnel.com"
  ttl     = 1
  proxied = true
}

data "cloudflare_zero_trust_tunnel_cloudflared_token" "router" {
  account_id = var.cloudflare_account_id
  tunnel_id  = cloudflare_zero_trust_tunnel_cloudflared.router.id
}

locals {
  database_url = "postgres://${urlencode(planetscale_postgres_branch_role.openbao.username)}:${urlencode(planetscale_postgres_branch_role.openbao.password)}@${planetscale_postgres_branch_role.openbao.access_host_url}/${planetscale_postgres_branch_role.openbao.database_name}?sslmode=require"
  bootstrap_secrets = {
    RAILWAY_TOKEN                = var.railway_token
    CF_API_TOKEN                 = var.cloudflare_api_token
    DB_CONNECTION_URI            = local.database_url
    PLANETSCALE_SERVICE_TOKEN_ID = var.planetscale_service_token_id
    PLANETSCALE_SERVICE_TOKEN    = var.planetscale_service_token
    TOFU_STATE_PASSPHRASE        = var.state_passphrase
    TOFU_STATE_ACCESS_KEY        = var.state_access_key
    TOFU_STATE_SECRET_KEY        = var.state_secret_key
    TOFU_VAULT_INPUTS            = var.vault_inputs
  }
}
resource "github_actions_secret" "bootstrap" {
  for_each = toset(keys(local.bootstrap_secrets))
  # The secret values are sensitive; the addresses are public, stable names.
  repository  = split("/", local.config.github.infra_repo)[1]
  secret_name = each.key
  value       = local.bootstrap_secrets[each.key]
}

resource "github_actions_variable" "account" {
  repository    = split("/", local.config.github.infra_repo)[1]
  variable_name = "CLOUDFLARE_ACCOUNT_ID"
  value         = var.cloudflare_account_id
}
resource "github_actions_variable" "zone" {
  repository    = split("/", local.config.github.infra_repo)[1]
  variable_name = "CLOUDFLARE_ZONE_ID"
  value         = cloudflare_zone.primary.id
}
resource "github_actions_variable" "migration_ready" {
  repository    = split("/", local.config.github.infra_repo)[1]
  variable_name = "TOFU_MIGRATION_READY"
  value         = tostring(var.migration_ready)
}

# crvouga is a personal account, so distribute the dispatch credential to the
# actual repositories instead of attempting to create organization secrets.
resource "github_actions_secret" "dispatch" {
  for_each    = toset([for service in local.config.services : split("/", service.github_repo)[1] if try(service.github_repo, null) != null])
  repository  = each.key
  secret_name = "DEPLOY_DISPATCH_TOKEN"
  value       = var.github_token
}

resource "cloudflare_dns_record" "redirect" {
  zone_id = cloudflare_zone.primary.id
  name    = local.config.zone
  type    = "A"
  content = local.config.cloudflare.placeholder_ipv4
  ttl     = 1
  proxied = true
}

resource "cloudflare_ruleset" "redirects" {
  zone_id = cloudflare_zone.primary.id
  name    = local.config.cloudflare.redirect_ruleset_name
  kind    = "zone"
  phase   = "http_request_dynamic_redirect"
  rules = [for redirect in local.config.cloudflare.redirects : {
    action      = "redirect"
    expression  = "(http.host eq \"${redirect.from}\")"
    description = "Redirect ${redirect.from}"
    enabled     = true
    action_parameters = {
      from_value = {
        status_code           = redirect.status
        preserve_query_string = true
        target_url = {
          expression = "concat(\"https://${one([for service in local.config.services : service.hostname if service.id == redirect.to_service])}\", http.request.uri.path)"
        }
      }
    }
  }]
}

resource "cloudflare_ruleset" "custom" {
  for_each    = local.config.cloudflare.custom_rulesets
  zone_id     = cloudflare_zone.primary.id
  name        = each.value.name
  description = each.value.description
  kind        = each.value.kind
  phase       = each.value.phase
  rules       = each.value.rules
}

output "project_id" { value = railway_project.workspace.id }
output "zone_id" { value = cloudflare_zone.primary.id }
output "environment_id" { value = railway_project.workspace.default_environment.id }
output "vault_addr" { value = local.vault_addr }
output "buckets" { value = { for key, bucket in cloudflare_r2_bucket.shared : key => bucket.name } }
output "router_token" {
  value     = data.cloudflare_zero_trust_tunnel_cloudflared_token.router.token
  sensitive = true
}
output "r2_access_key_id" {
  value     = cloudflare_account_token.r2.id
  sensitive = true
}
output "r2_secret_access_key" {
  value     = sha256(cloudflare_account_token.r2.value)
  sensitive = true
}
output "vault_image_tag" { value = var.vault_image_tag }
output "database_url" {
  value     = local.database_url
  sensitive = true
}
