# Runs that need inventory observability.live = true. tests/foundation.py plans
# them in a copy whose inventory turns it on, with foundation.tftest.hcl's mocks.
run "live_observability_monitors_every_public_service" {
  command = plan
  variables {
    grafana_cloud_access_policy_token = "glc_test"
  }
  assert {
    condition     = length(grafana_cloud_stack.shared) == 1 && length(grafana_synthetic_monitoring_installation.shared) == 1
    error_message = "A live stack must install synthetic monitoring."
  }
  assert {
    condition     = toset(keys(grafana_synthetic_monitoring_check.public)) == toset([for service in local.config.services : service.id if try(service.kind, "railway") == "railway" && !try(service.internal, false) && try(service.health_check, true)])
    error_message = "Every public service with a health check must have a synthetic check."
  }
  assert {
    condition     = grafana_synthetic_monitoring_check.public["vault"].target == "https://vault.chrisvouga.dev/v1/sys/health?standbyok=true&sealedcode=200&uninitcode=200" && grafana_synthetic_monitoring_check.public["portfolio"].target == "https://www.chrisvouga.dev/"
    error_message = "Checks must probe the same health URLs as health-check --all-public."
  }
  assert {
    condition     = alltrue([for check in grafana_synthetic_monitoring_check.public : check.frequency == 900000 && check.timeout == 30000])
    error_message = "Checks must run every 15 minutes to stay inside the free plan."
  }
}
