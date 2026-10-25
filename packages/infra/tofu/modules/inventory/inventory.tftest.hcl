run "fleet_browser_auth_contract" {
  command = plan
  assert {
    condition = one([for service in output.config.services :
      try(service.env.FLEET_OIDC_ISSUER, "") == "https://${output.config.auth_relay.instances.production.hostname}/realms/${output.config.auth_relay.instances.production.realm}" &&
      startswith(try(service.env.FLEET_OIDC_CLIENT_ID, ""), "app-") &&
      try(service.env.FLEET_PUBLIC_ORIGIN, "") == "https://${service.hostname}"
      if service.id == "fleet-api"
    ])
    error_message = "Fleet must retain its registered production browser-auth configuration across deployments."
  }
}

run "fleet_contract" {
  command = plan
  assert {
    condition     = length(output.config.services) == 22
    error_message = "The migration must retain all 22 Railway services."
  }
  assert {
    condition     = length(distinct([for service in output.config.services : service.id])) == length(output.config.services)
    error_message = "Service addresses must be unique."
  }
  assert {
    condition     = alltrue([for service in output.config.services : endswith(service.hostname, output.config.zone)])
    error_message = "Every hosted service must have a hostname in the managed zone."
  }
  assert {
    condition     = toset([for store in output.config.object_stores : store.bucket]) == toset(["crvouga-development", "crvouga-production"])
    error_message = "Keep the existing shared buckets and their contents."
  }
  assert {
    condition     = output.config.vault.init.key_threshold == 2 && output.config.vault.init.key_shares == 3
    error_message = "Preserve the existing Shamir seal parameters."
  }
  assert {
    condition     = output.config.github.pr_ready.actions.default_workflow_permissions == "read" && !output.config.github.pr_ready.actions.can_approve_pull_request_reviews
    error_message = "GitHub Actions must default to a read-only token that cannot approve pull requests."
  }
  assert {
    condition     = output.config.github.pr_ready.security.vulnerability_alerts && output.config.github.pr_ready.security.dependabot_security_updates
    error_message = "GitHub dependency alerts and automated security updates must remain enabled."
  }
  assert {
    condition     = length(distinct([for label in output.config.github.pr_ready.labels : label.name])) == length(output.config.github.pr_ready.labels)
    error_message = "GitHub issue label names must be unique."
  }
  assert {
    condition     = alltrue([for ruleset in values(output.config.cloudflare.custom_rulesets) : ruleset.kind == "zone" && length(ruleset.rules) > 0])
    error_message = "Every custom Cloudflare ruleset must remain zone-scoped and contain a declared rule."
  }
  assert {
    condition     = output.config.cloudflare.zone_settings.ssl == "strict" && output.config.cloudflare.dns_settings.zone_mode == "standard"
    error_message = "Cloudflare TLS and DNS policy must remain explicit desired state."
  }
  assert {
    condition     = length(output.config.github.repositories) == 16 && alltrue([for repository in values(output.config.github.repositories) : contains(["main", "master"], repository.default_branch)])
    error_message = "Every application repository and its default branch must be declared."
  }
  assert {
    condition     = one(output.config.postgres.projects).cluster_size == "PS_5_AWS_ARM" && one(output.config.postgres.projects).replicas == 0 && one(output.config.postgres.projects).region == "us-east"
    error_message = "PostgreSQL must stay the cheapest single-node single-region size."
  }
}

run "squarespace_domain_contract" {
  command = plan
  assert {
    condition     = length(output.config.domains) == 14 && alltrue([for spec in values(output.config.domains) : spec.domain_manager == "squarespace" && contains(["69", "895", "3827"], spec.registrar_iana_id)])
    error_message = "All 14 registrations must remain at Squarespace."
  }
  assert {
    condition     = toset([for domain, spec in output.config.domains : domain if spec.manage_zone || domain == output.config.zone]) == toset(["chrisvouga.dev", "gamezilla.app", "moviefinder.app", "normalizer.app"])
    error_message = "Only the four original Cloudflare DNS zones may remain managed."
  }
  assert {
    condition     = alltrue([for spec in values(output.config.domains) : !contains(keys(spec), "transfer_enabled") && !contains(keys(spec), "manage_registration") && length(spec.nameservers) >= 2])
    error_message = "Keep original delegations and remove all registrar transfer controls."
  }
  assert {
    condition     = toset([for domain, spec in output.config.domains : domain if spec.availability == "critical"]) == toset(["chrisvouga.dev", "gamezilla.app"]) && alltrue([for spec in values(output.config.domains) : spec.availability != "critical" || (spec.web_usage == "required" && length(spec.https) >= 2)])
    error_message = "Both critical sites must retain apex/www availability probes."
  }
  assert {
    condition     = output.config.domains[output.config.zone].dnssec_status == output.config.cloudflare.dnssec_status && output.config.domains["emulates.dev"].dnssec_status == "disabled"
    error_message = "Keep primary DNSSEC policy and retain the accepted disabled DNSSEC policy for unused emulates.dev."
  }
}

run "router_stateless_contract" {
  command = plan
  assert {
    condition = alltrue([for service in output.config.services :
      service.kind == "railway" && service.railway.replicas == 1 && try(service.railway.sleep, true) && !service.railway.health_check && service.env.DATA_DIR == "/tmp/9router"
      if service.id == "9router"
    ])
    error_message = "9router must restore ephemeral SQLite under a single-writer lock, without a deployment healthcheck that deadlocks handoff."
  }
  assert {
    condition     = length(output.config.tunnels) == 0
    error_message = "9router public ingress belongs to Railway, not a local tunnel."
  }
}

run "external_application_hosting_contract" {
  command = plan
  assert {
    condition = alltrue([for service in output.config.services :
      startswith(try(service.health_path, "/"), "/") && contains(keys(output.config.github.repositories), trimprefix(service.github_repo, "${output.config.github.org}/"))
      if try(service.github_repo, null) != null && try(service.github_repo, null) != output.config.github.infra_repo
    ])
    error_message = "Every external application must reference a declared repository and health path."
  }
  assert {
    condition = alltrue([for settings in values(output.config.github.repositories) :
      length(try(settings.required_status_checks, [])) > 0 if !try(settings.managed_publisher, true)
    ])
    error_message = "Application-owned publishers must retain required validation checks."
  }
}

run "email_service_contract" {
  command = plan
  assert {
    condition = alltrue([for service in output.config.services :
      contains([for secret in service.secrets : secret.name], "RESEND_API_KEY") && strcontains(service.env.EMAIL_FROM, "@")
      if try(service.env.EMAIL_FROM, null) != null
    ])
    error_message = "Email-enabled services must declare credentials and a sender."
  }
  assert {
    condition     = output.config.cloudflare.dns.records["send.resend.chrisvouga.dev_TXT"].content == "v=spf1 include:amazonses.com ~all" && startswith(output.config.cloudflare.dns.records["resend._domainkey.resend.chrisvouga.dev_TXT"].content, "p=")
    error_message = "The shared email domain requires both SPF and DKIM TXT records."
  }
}

run "moviefinder_ownership" {
  command = plan
  assert {
    condition = one([for service in output.config.services :
      try(service.env.MOVIEFINDER_OIDC_ISSUER, "") == "https://${output.config.auth_relay.instances.production.hostname}/realms/${output.config.auth_relay.instances.production.realm}" &&
      startswith(try(service.env.MOVIEFINDER_OIDC_CLIENT_ID, ""), "app-")
      if service.id == "moviefinder"
    ])
    error_message = "MovieFinder must retain its registered production Google sign-in settings."
  }
  assert {
    condition     = one([for service in output.config.services : service if service.id == "moviefinder"]).github_repo == "crvouga/moviefinder" && one([for service in output.config.services : service if service.id == "moviefinder"]).database_schema == "moviefinder"
    error_message = "The new MovieFinder service and schema must belong to its own application repository."
  }
  assert {
    condition     = !output.config.github.repositories.moviefinder.managed_publisher && toset(output.config.github.repositories.moviefinder.required_status_checks) == toset(["fast", "integration", "browser-and-container"])
    error_message = "The application must retain its publisher and validation ownership."
  }
  assert {
    condition     = one([for key in output.config.vault.kv_keys : key if key.name == "MOVIEFINDER_AUTH_SECRET"]).generated && one([for key in output.config.vault.kv_keys : key if key.name == "MOVIEFINDER_AUTH_SECRET"]).configs == ["dev", "prd"]
    error_message = "Generate the app-specific auth key through Vault, without rotating any existing key."
  }
}
