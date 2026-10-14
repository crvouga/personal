# DNS moves before registration. Existing primary addresses remain unchanged.
# Additional zones/records are populated by a reviewed offline inventory draft.
locals {
  domain_zones = { for domain, spec in local.config.domains : domain => spec if spec.manage_zone && domain != local.config.zone }
  domain_zone_ids = merge(
    { (local.config.zone) = cloudflare_zone.primary.id },
    { for domain, zone in cloudflare_zone.domain : domain => zone.id }
  )
  domain_records = merge({}, [for domain, spec in local.config.domains : {
    for key, record in spec.records : "${domain}:${key}" => merge(record, { domain = domain })
  } if domain == local.config.zone || spec.manage_zone]...)
}

resource "cloudflare_zone" "domain" {
  for_each = local.domain_zones
  account  = { id = var.cloudflare_account_id }
  name     = each.key
  type     = "full"
  lifecycle { prevent_destroy = true }
}

import {
  for_each = { for domain, spec in local.domain_zones : domain => spec.existing_zone_id if try(spec.existing_zone_id, "") != "" }
  to       = cloudflare_zone.domain[each.key]
  id       = each.value
}

resource "cloudflare_dns_record" "domain" {
  for_each = local.domain_records
  zone_id  = local.domain_zone_ids[each.value.domain]
  name     = each.value.name
  type     = each.value.type
  ttl      = each.value.ttl
  proxied  = each.value.proxied
  content  = try(length(each.value.data), 0) > 0 ? null : try(each.value.content, null)
  data     = try(each.value.data, null)
  priority = try(each.value.priority, null)
  settings = try(each.value.settings, null)
  lifecycle { prevent_destroy = true }
}

import {
  for_each = { for key, record in local.domain_records : key => record if try(record.id, "") != "" }
  to       = cloudflare_dns_record.domain[each.key]
  id       = "${local.domain_zone_ids[each.value.domain]}/${each.value.id}"
}

resource "cloudflare_zone_dnssec" "domain" {
  for_each = local.domain_zones
  zone_id  = cloudflare_zone.domain[each.key].id
  status   = each.value.dnssec_status
}

import {
  for_each = { for domain, spec in local.domain_zones : domain => spec.existing_zone_id if try(spec.existing_zone_id, "") != "" }
  to       = cloudflare_zone_dnssec.domain[each.key]
  id       = each.value
}

# Provider 5.26.0 Create calls Registrar.Domains.Update, never transfer-in.
# Enable only AFTER transfer completion has been independently verified.
# This singleton has no importer; its Create adopts settings on an existing registration.
resource "cloudflare_registrar_domain" "domain" {
  for_each    = { for domain, spec in local.config.domains : domain => spec if spec.manage_registration }
  account_id  = var.cloudflare_account_id
  domain_name = each.key
  auto_renew  = true
  locked      = true
  privacy     = true
  lifecycle { prevent_destroy = true }
}

output "domain_nameservers" {
  value = merge(
    { (local.config.zone) = cloudflare_zone.primary.name_servers },
    { for domain, zone in cloudflare_zone.domain : domain => zone.name_servers }
  )
}

# Stage DNS-only first. Enable forwarding only after delegation is active and
# the read-only forwarding gate confirms Cloudflare has issued edge certificates.
resource "cloudflare_ruleset" "domain_forwarding" {
  for_each = { for domain, spec in local.config.domains : domain => spec if spec.forwarding_enabled && length(spec.forwarding) > 0 }
  zone_id  = local.domain_zone_ids[each.key]
  name     = "Domain forwarding ${each.key}"
  kind     = "zone"
  phase    = "http_request_dynamic_redirect"
  rules = flatten([for redirect in each.value.forwarding : concat([
    {
      action      = "redirect"
      expression  = redirect.preserve_path ? "(http.host eq \"${redirect.hostname}\" and http.request.uri.path eq \"/\")" : "(http.host eq \"${redirect.hostname}\")"
      description = "Forward ${redirect.hostname}"
      enabled     = true
      action_parameters = {
        from_value = {
          status_code           = redirect.status
          preserve_query_string = redirect.preserve_query
          target_url            = { value = redirect.target }
        }
      }
    }
    ], redirect.preserve_path ? [
    {
      action      = "redirect"
      expression  = "(http.host eq \"${redirect.hostname}\" and http.request.uri.path ne \"/\")"
      description = "Forward paths for ${redirect.hostname}"
      enabled     = true
      action_parameters = {
        from_value = {
          status_code           = redirect.status
          preserve_query_string = redirect.preserve_query
          target_url            = { expression = "concat(\"${redirect.target}\", http.request.uri.path)" }
        }
      }
    }
  ] : [])])
  lifecycle { prevent_destroy = true }
}
