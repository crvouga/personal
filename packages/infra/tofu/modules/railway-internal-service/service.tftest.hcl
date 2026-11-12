mock_provider "railway" {
  mock_resource "railway_service" {
    defaults = { id = "12345678-1234-4234-8234-123456789014" }
  }
}
mock_provider "graphql" {}

variables {
  project_id     = "12345678-1234-4234-8234-123456789012"
  environment_id = "12345678-1234-4234-8234-123456789013"
  region         = "us-east4"
  image          = "ghcr.io/example/sidecar:1.2.3"
  variables      = { PORT = "4848", UPSTREAM_DB = "test-credential" }
  service = {
    id          = "sidecar"
    internal    = true
    port        = 4848
    health_path = "/keepalive"
    railway = {
      sleep                  = false
      replicas               = 1
      volume                 = { name = "sidecar-data", mount_path = "/data" }
      health_timeout_seconds = 600
    }
  }
}

run "private_service" {
  command = plan
  assert {
    condition     = railway_service.this.source_image == "ghcr.io/example/sidecar:1.2.3" && railway_service.this.volume.mount_path == "/data"
    error_message = "The image and the volume must be owned by OpenTofu."
  }
  assert {
    condition     = graphql_mutation.settings.mutation_variables.healthcheckPath == "/keepalive" && graphql_mutation.settings.mutation_variables.healthcheckTimeout == "600" && graphql_mutation.settings.mutation_variables.sleepApplication == "false"
    error_message = "An internal service keeps its deploy probe, time budget and sleep setting."
  }
}

run "same_settings_as_public_services" {
  command = plan
  assert {
    condition     = railway_service.this.name == "sidecar" && trimspace(split("output \"id\"", split("# The Railway provider does not expose", file("./main.tf"))[1])[0]) == trimspace(split("resource \"railway_custom_domain\"", split("# The Railway provider does not expose", file("../railway-service/main.tf"))[1])[0])
    error_message = "Keep the settings and variables identical to modules/railway-service; only the domain and DNS records differ."
  }
}

run "rejects_hostname" {
  command = plan
  variables {
    service = {
      id       = "sidecar"
      internal = true
      hostname = "sidecar.example.com"
      port     = 4848
    }
  }
  expect_failures = [railway_service.this]
}

run "volume_rejects_multiple_writers" {
  command = plan
  variables {
    service = {
      id       = "sidecar"
      internal = true
      port     = 4848
      railway = {
        replicas = 2
        volume   = { name = "sidecar-data", mount_path = "/data" }
      }
    }
  }
  expect_failures = [railway_service.this]
}
