mock_provider "cloudflare" {
  mock_resource "cloudflare_zone" {
    defaults = { id = "83db052d18159889dd290724ac7d52d9", name_servers = ["one.ns.cloudflare.com", "two.ns.cloudflare.com"] }
  }
}

run "domain_adoption_and_forwarding" {
  command = plan
  assert {
    condition     = keys(cloudflare_zone.domain) == ["unused.example"]
    error_message = "Additional-zone adoption must preserve the existing primary zone address."
  }
  assert {
    condition     = length(cloudflare_dns_record.domain) == 5
    error_message = "Every migrated record, including structured CAA/SRV and repeated MX, must survive."
  }
  assert {
    condition     = cloudflare_dns_record.domain["unused.example:caa"].data.tag == "issue" && cloudflare_dns_record.domain["unused.example:caa"].data.value == "letsencrypt.org"
    error_message = "Structured CAA issuer configuration must be preserved."
  }
  assert {
    condition     = cloudflare_dns_record.domain["unused.example:srv"].data.port == 5060
    error_message = "SRV transport parameters must be preserved."
  }
  assert {
    condition     = length(cloudflare_ruleset.domain_forwarding["unused.example"].rules) == 2 && cloudflare_ruleset.domain_forwarding["unused.example"].rules[0].action_parameters.from_value.target_url.value == "http://destination.example" && cloudflare_ruleset.domain_forwarding["unused.example"].rules[1].action_parameters.from_value.target_url.expression == "concat(\"http://destination.example\", http.request.uri.path)"
    error_message = "Root and path-preserving redirects need distinct rules to preserve the exact Location behavior."
  }
  assert {
    condition     = cloudflare_registrar_domain.domain["unused.example"].locked && cloudflare_registrar_domain.domain["unused.example"].auto_renew && cloudflare_registrar_domain.domain["unused.example"].privacy
    error_message = "Post-transfer adoption must retain renewal, lock and WHOIS privacy."
  }
}
