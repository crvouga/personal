run "fleet_contract" {
  command = plan
  assert {
    condition     = length(output.config.services) == 19
    error_message = "The migration must retain all 18 Railway services and the 9router tunnel."
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
    condition     = length(output.config.github.repositories) == 14 && alltrue([for repository in values(output.config.github.repositories) : contains(["main", "master"], repository.default_branch)])
    error_message = "Every application repository and its default branch must be declared."
  }
  assert {
    condition     = one(output.config.postgres.projects).cluster_size == "PS_5_AWS_ARM" && one(output.config.postgres.projects).replicas == 0 && one(output.config.postgres.projects).region == "us-east"
    error_message = "PostgreSQL must stay the cheapest single-node single-region size."
  }
}
