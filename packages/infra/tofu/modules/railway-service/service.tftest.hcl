mock_provider "railway" {
  mock_resource "railway_service" {
    defaults = { id = "12345678-1234-4234-8234-123456789014" }
  }
  mock_resource "railway_custom_domain" {
    defaults = {
      dns_record_value          = "service.up.railway.app"
      verification_host_label   = "_railway-verify.app.example.com"
      verification_record_value = "verification-value"
    }
  }
}
mock_provider "graphql" {}
mock_provider "cloudflare" {}

variables {
  project_id     = "12345678-1234-4234-8234-123456789012"
  environment_id = "12345678-1234-4234-8234-123456789013"
  zone_id        = "zone-id"
  region         = "us-east4"
  image          = "ghcr.io/example/app:revision"
  variables      = { PORT = "8080", DATABASE_URL = "test-credential" }
  service = {
    id          = "app"
    hostname    = "app.example.com"
    port        = 8080
    health_path = "/health"
    railway     = { sleep = false }
  }
}

run "image_and_environment" {
  command = plan
  assert {
    condition     = length(graphql_mutation.registry_credentials) == 0
    error_message = "Public image services must not receive private registry credentials."
  }
  assert {
    condition     = railway_service.this.source_image == "ghcr.io/example/app:revision"
    error_message = "An image revision must be owned by OpenTofu, not a deployment script."
  }
  assert {
    condition     = railway_custom_domain.this.target_port == 8080 && railway_custom_domain.this.environment_id == "12345678-1234-4234-8234-123456789013"
    error_message = "Domain routing must use the declared port and environment."
  }
  assert {
    condition     = graphql_mutation.settings.mutation_variables.sleepApplication == "false"
    error_message = "Always-on services must retain their sleep setting."
  }
  assert {
    condition     = graphql_mutation.settings.mutation_variables.healthcheckPath == "/health"
    error_message = "Healthcheck configuration must be managed by OpenTofu."
  }
  assert {
    condition = alltrue([
      strcontains(graphql_mutation.settings.create_mutation, "builder: RAILPACK"),
      strcontains(graphql_mutation.settings.create_mutation, "restartPolicyType: ON_FAILURE"),
      strcontains(graphql_mutation.settings.create_mutation, "ipv6EgressEnabled: false"),
      strcontains(graphql_mutation.settings.create_mutation, "tracingEnabled: false"),
      strcontains(graphql_mutation.settings.create_mutation, "watchPatterns: []"),
    ])
    error_message = "Mutable Railway build and deploy settings must remain owned by OpenTofu."
  }
}

run "locked_writer_handoff" {
  command = plan
  variables {
    service = {
      id          = "9router"
      hostname    = "9router.example.com"
      port        = 20128
      health_path = "/api/health"
      railway     = { sleep = false, health_check = false }
    }
  }
  assert {
    condition     = graphql_mutation.settings.mutation_variables.healthcheckPath == "null"
    error_message = "Disable only the Railway deploy probe so the old writer can stop before the new writer restores. Public health probes remain enabled."
  }
}

run "private_registry" {
  command = plan
  variables {
    registry_password = "test-only-registry-password"
    service = {
      id       = "private-app"
      hostname = "private.example.com"
      port     = 8080
      railway  = { registry = { username = "example", vault_key = "GHCR_TOKEN" } }
    }
  }
  assert {
    condition     = length(graphql_mutation.registry_credentials) == 1
    error_message = "Private images must configure Railway registry credentials."
  }
  assert {
    condition     = nonsensitive(jsondecode(graphql_mutation.registry_credentials[0].mutation_variables.credentials).username) == "example"
    error_message = "Use the declared registry username."
  }
  assert {
    condition     = graphql_mutation.registry_credentials[0].enable_remote_state_verification == false && graphql_mutation.settings.enable_remote_state_verification != false
    error_message = "Only write-only credentials bypass remote verification; ordinary settings must still detect drift."
  }
}

run "missing_registry_password" {
  command = plan
  variables {
    service = {
      id       = "private-app"
      hostname = "private.example.com"
      port     = 8080
      railway  = { registry = { username = "example", vault_key = "GHCR_TOKEN" } }
    }
  }
  expect_failures = [graphql_mutation.registry_credentials[0]]
}
