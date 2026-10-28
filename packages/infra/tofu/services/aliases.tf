locals {
  aliases = { for alias in local.config.aliases : alias.hostname => alias }
}

# Additional domains attach to existing services without changing their primary
# hostname, image, environment or application origin.
resource "railway_custom_domain" "alias" {
  for_each       = local.aliases
  domain         = each.key
  environment_id = data.terraform_remote_state.foundation.outputs.environment_id
  service_id     = module.service[try(local.services[each.value.service].state_key, each.value.service)].id
  target_port    = local.services[each.value.service].port
}

resource "cloudflare_dns_record" "alias" {
  for_each = local.aliases
  zone_id  = local.config.domains[each.value.zone].existing_zone_id
  name     = each.key
  type     = "CNAME"
  content  = railway_custom_domain.alias[each.key].dns_record_value
  ttl      = 1
  proxied  = try(each.value.proxied, false)
}

resource "cloudflare_dns_record" "alias_verification" {
  for_each = local.aliases
  zone_id  = local.config.domains[each.value.zone].existing_zone_id
  name     = railway_custom_domain.alias[each.key].verification_host_label
  type     = "TXT"
  content  = railway_custom_domain.alias[each.key].verification_record_value
  ttl      = 1
}

import {
  for_each = { for hostname, alias in local.aliases : hostname => alias if try(alias.existing_record_id, "") != "" }
  to       = cloudflare_dns_record.alias[each.key]
  id       = "${local.config.domains[each.value.zone].existing_zone_id}/${each.value.existing_record_id}"
}
