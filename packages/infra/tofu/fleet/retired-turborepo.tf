# Isolate the retired instance so its removal does not relax the shared
# railway-service module's prevent_destroy guard for any active service.
moved {
  from = module.service["turborepo"]
  to   = module.retired_turborepo
}

removed {
  from = module.retired_turborepo
  lifecycle { destroy = true }
}
