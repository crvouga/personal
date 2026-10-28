# Isolate retirement so the active shared module keeps prevent_destroy.
moved {
  from = module.service["fleet-api"]
  to   = module.retired_fleet_api
}
removed {
  from = module.retired_fleet_api
  lifecycle { destroy = true }
}

# The first retirement apply deleted the service before Railway finished its
# cascading domain deletion. The provider then failed to delete the domain and
# cannot refresh the now-absent object (run 40605539666, attempts 1 and 2).
# Isolate only that stale address; all other retirement resources still destroy.
moved {
  from = module.retired_fleet_api.railway_custom_domain.this
  to   = railway_custom_domain.retired_fleet_api
}
removed {
  from = railway_custom_domain.retired_fleet_api
  lifecycle { destroy = false }
}
