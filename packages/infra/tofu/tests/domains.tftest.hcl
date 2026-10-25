mock_provider "cloudflare" {
  mock_resource "cloudflare_zone" {
    defaults = { id = "83db052d18159889dd290724ac7d52d9", name_servers = ["one.ns.cloudflare.com", "two.ns.cloudflare.com"] }
  }
}

run "existing_domain_dns" {
  command = plan
  assert {
    condition     = length(cloudflare_zone_setting.domain_ssl) == 1 && cloudflare_zone_setting.domain_ssl["unused.example"].value == "full" && cloudflare_zone_setting.domain_ssl["unused.example"].zone_id == cloudflare_zone.domain["unused.example"].id
    error_message = "Explicit origin TLS policy must be scoped to its additional zone."
  }
  assert {
    condition     = keys(cloudflare_zone.domain) == ["unused.example"]
    error_message = "Additional-zone adoption must preserve the existing primary zone address."
  }
  assert {
    condition     = length(cloudflare_dns_record.domain) == 5
    error_message = "Every existing record, including structured CAA/SRV and repeated MX, must survive."
  }
  assert {
    condition     = cloudflare_dns_record.domain["unused.example:caa"].data.tag == "issue" && cloudflare_dns_record.domain["unused.example:caa"].data.value == "letsencrypt.org"
    error_message = "Structured CAA issuer configuration must be preserved."
  }
  assert {
    condition     = cloudflare_dns_record.domain["unused.example:srv"].data.port == 5060
    error_message = "SRV transport parameters must be preserved."
  }
}
