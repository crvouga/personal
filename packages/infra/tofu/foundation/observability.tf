# Shared observability: one Grafana Cloud stack receives OpenTelemetry (OTLP)
# logs, traces and metrics from every project. Apps only see standard OTEL_*
# variables, so the backend can be replaced without touching application code.
#
# Nothing is created until inventory `observability.live` is true, which needs
# GRAFANA_CLOUD_ACCESS_POLICY_TOKEN in Vault prd first. `bun run
# observability:bootstrap` stores it and turns this on.
locals {
  observability = local.config.observability
  grafana       = local.observability.enabled && local.observability.live ? { shared = local.observability } : {}
}

# Grafana Cloud creates a stack at sign-up. Adopt it instead of creating a
# second one, which the free plan may not allow. The bootstrap script records
# its slug and real region; a region change would replace the stack.
import {
  for_each = { for key, value in local.grafana : key => value if value.stack.adopt }
  to       = grafana_cloud_stack.shared[each.key]
  id       = each.value.stack.slug
}

resource "grafana_cloud_stack" "shared" {
  for_each          = local.grafana
  name              = each.value.stack.name
  slug              = each.value.stack.slug
  region_slug       = each.value.stack.region
  delete_protection = true
  lifecycle {
    prevent_destroy = true
    precondition {
      condition     = nonsensitive(trimspace(var.grafana_cloud_access_policy_token) != "")
      error_message = "observability.live needs GRAFANA_CLOUD_ACCESS_POLICY_TOKEN in Vault prd and the GRAFANA_CLOUD_ACCESS_POLICY_TOKEN Actions secret. Run `bun run observability:bootstrap` before enabling it."
    }
  }
}

# Write-only ingest credential shared by every service. It cannot read data.
resource "grafana_cloud_access_policy" "ingest" {
  for_each     = local.grafana
  region       = grafana_cloud_stack.shared[each.key].region_slug
  name         = "${each.value.stack.slug}-otlp-ingest"
  display_name = "Shared OTLP ingest"
  scopes       = each.value.ingest_scopes
  realm {
    type       = "stack"
    identifier = grafana_cloud_stack.shared[each.key].id
  }
}

resource "grafana_cloud_access_policy_token" "ingest" {
  for_each         = local.grafana
  region           = grafana_cloud_access_policy.ingest[each.key].region
  access_policy_id = grafana_cloud_access_policy.ingest[each.key].policy_id
  name             = "${each.value.stack.slug}-otlp-ingest"
  display_name     = "Shared OTLP ingest"
}

# Read-only Grafana identity for agents (Grafana MCP server, HTTP API).
resource "grafana_cloud_stack_service_account" "agents" {
  for_each   = local.grafana
  stack_slug = grafana_cloud_stack.shared[each.key].slug
  name       = "agents"
  role       = each.value.agent_role
}

resource "grafana_cloud_stack_service_account_token" "agents" {
  for_each           = local.grafana
  stack_slug         = grafana_cloud_stack.shared[each.key].slug
  service_account_id = grafana_cloud_stack_service_account.agents[each.key].id
  name               = "agents"
}

output "observability" {
  sensitive = true
  value = { for key, stack in grafana_cloud_stack.shared : key => {
    grafana_url   = stack.url
    otlp_endpoint = stack.otlp_url
    # OTLP/HTTP basic auth: the stack ID is the user, the token the password.
    # The space is percent-encoded as the OTEL_EXPORTER_OTLP_HEADERS spec requires.
    otlp_headers          = "Authorization=Basic%20${base64encode("${stack.id}:${grafana_cloud_access_policy_token.ingest[key].token}")}"
    service_account_token = grafana_cloud_stack_service_account_token.agents[key].key
  } }
}

# Synthetic monitoring: Grafana's public probes request every public service's
# health URL, the same targets `bun run health-check --all-public` uses, and
# alert through the stack's default notification policy (the account owner's
# email). 24 checks from one probe every 15 minutes is about 70k executions a
# month, inside the free plan's 100k.
locals {
  synthetic = { for key, value in local.grafana : key => value.synthetic_monitoring if try(value.synthetic_monitoring.enabled, false) }
  monitored = length(local.synthetic) == 0 ? {} : {
    for service in local.config.services : service.id => "https://${service.hostname}${try(service.health_path, "/")}"
    if try(service.kind, "railway") == "railway" && !try(service.internal, false) && try(service.health_check, true) && try(service.hostname, "") != ""
  }
}

# Synthetic monitoring publishes its results with its own write-only token.
resource "grafana_cloud_access_policy" "synthetic" {
  for_each     = local.synthetic
  region       = grafana_cloud_stack.shared[each.key].region_slug
  name         = "${grafana_cloud_stack.shared[each.key].slug}-synthetic-monitoring"
  display_name = "Synthetic monitoring publisher"
  scopes       = ["metrics:write", "stacks:read", "logs:write", "traces:write"]
  realm {
    type       = "stack"
    identifier = grafana_cloud_stack.shared[each.key].id
  }
}

resource "grafana_cloud_access_policy_token" "synthetic" {
  for_each         = local.synthetic
  region           = grafana_cloud_access_policy.synthetic[each.key].region
  access_policy_id = grafana_cloud_access_policy.synthetic[each.key].policy_id
  name             = "${grafana_cloud_stack.shared[each.key].slug}-synthetic-monitoring"
  display_name     = "Synthetic monitoring publisher"
}

resource "grafana_synthetic_monitoring_installation" "shared" {
  for_each              = local.synthetic
  stack_id              = grafana_cloud_stack.shared[each.key].id
  metrics_publisher_key = grafana_cloud_access_policy_token.synthetic[each.key].token
}

data "grafana_synthetic_monitoring_probes" "shared" {
  for_each   = local.synthetic
  provider   = grafana.synthetic
  depends_on = [grafana_synthetic_monitoring_installation.shared]
}

resource "grafana_synthetic_monitoring_check" "public" {
  for_each  = local.monitored
  provider  = grafana.synthetic
  job       = each.key
  target    = each.value
  enabled   = true
  frequency = local.synthetic.shared.frequency_ms
  timeout   = local.synthetic.shared.timeout_ms
  probes    = [for name in local.synthetic.shared.probes : data.grafana_synthetic_monitoring_probes.shared["shared"].probes[name]]
  labels    = { service = replace(each.key, "-", "_") }
  settings {
    http {
      method          = "GET"
      fail_if_not_ssl = true
    }
  }
  lifecycle {
    precondition {
      condition     = alltrue([for name in local.synthetic.shared.probes : contains(keys(data.grafana_synthetic_monitoring_probes.shared["shared"].probes), name)])
      error_message = "observability.synthetic_monitoring.probes names a probe Grafana does not offer."
    }
  }
}

resource "grafana_synthetic_monitoring_check_alerts" "public" {
  for_each = grafana_synthetic_monitoring_check.public
  provider = grafana.synthetic
  check_id = each.value.id
  alerts = [
    {
      name        = "ProbeFailedExecutionsTooHigh"
      threshold   = local.synthetic.shared.alerts.failures
      period      = local.synthetic.shared.alerts.period
      runbook_url = ""
    },
    {
      name        = "TLSTargetCertificateCloseToExpiring"
      threshold   = local.synthetic.shared.alerts.tls_expiry_days
      period      = ""
      runbook_url = ""
    },
  ]
}
