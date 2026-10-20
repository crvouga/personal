mock_provider "railway" {
  mock_resource "railway_service" {
    defaults = { id = "12345678-1234-4234-8234-123456789014" }
  }
}
mock_provider "graphql" {}

variables {
  project_id     = "12345678-1234-4234-8234-123456789012"
  environment_id = "12345678-1234-4234-8234-123456789013"
  region         = "us-west2"
  image          = "ghcr.io/example/identity@sha256:0000000000000000000000000000000000000000000000000000000000000000"
  variables      = { KC_DB = "postgres" }
  service        = { id = "identity", health_path = "/health/ready", railway = { sleep = false, replicas = 1 } }
}

# Provider 0.6.2 cannot lower num_replicas after creation, so the settings
# mutation owns the replica count and the service ignores its regions.
run "single_replica_is_set_by_the_settings_mutation" {
  command = plan
  assert {
    condition     = jsondecode(graphql_mutation.settings.mutation_variables.multiRegionConfig) == { us-west2 = { numReplicas = 1 } }
    error_message = "The settings mutation must set the region's replica count."
  }
  assert {
    condition     = strcontains(local.update_settings, "multiRegionConfig: $multiRegionConfig") && strcontains(local.update_settings, "$multiRegionConfig: JSON!")
    error_message = "The update mutation must pass multiRegionConfig as a JSON variable."
  }
}

run "replica_count_follows_the_service_definition" {
  command = plan
  variables {
    service = { id = "tunnel", railway = { sleep = false, replicas = 2, health_check = false } }
  }
  assert {
    condition     = jsondecode(graphql_mutation.settings.mutation_variables.multiRegionConfig) == { us-west2 = { numReplicas = 2 } }
    error_message = "Connector replicas must come from the service definition."
  }
  assert {
    condition     = graphql_mutation.settings.mutation_variables.healthcheckPath == "null"
    error_message = "A service without a health check must clear the path."
  }
}
