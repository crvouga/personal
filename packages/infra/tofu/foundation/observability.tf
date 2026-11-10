# Shared observability: one Grafana Cloud stack receives OpenTelemetry (OTLP)
# logs, traces and metrics from every project. Apps only see standard OTEL_*
# variables, so the backend can be replaced without touching application code.
#
# Nothing is created until inventory `observability.live` is true, which needs
# GRAFANA_CLOUD_ACCESS_POLICY_TOKEN in Vault prd first (see the
# Observability section of llms-cloud.txt).
locals {
  observability = local.config.observability
  grafana       = local.observability.enabled && local.observability.live ? { shared = local.observability } : {}
}

# Grafana Cloud creates a stack at sign-up. Adopt it instead of creating a
# second one, which the free plan may not allow.
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
      error_message = "observability.live needs GRAFANA_CLOUD_ACCESS_POLICY_TOKEN in Vault prd and the GRAFANA_CLOUD_ACCESS_POLICY_TOKEN Actions secret. Store it with `bun run vault:edit` before enabling it."
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
