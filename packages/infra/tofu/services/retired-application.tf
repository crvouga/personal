# Isolate retirement so the active shared module keeps prevent_destroy.
moved {
  from = module.service["fleet-api"]
  to   = module.retired_fleet_api
}
removed {
  from = module.retired_fleet_api
  lifecycle { destroy = true }
}
