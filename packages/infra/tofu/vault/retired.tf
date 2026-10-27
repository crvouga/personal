removed {
  from = vault_auth_backend.retired_oidc
  lifecycle { destroy = true }
}

removed {
  from = vault_mount.retired_smoke
  lifecycle { destroy = true }
}

# Retire both private cache publishers and the isolated signing document.
removed {
  from = vault_kv_secret_v2.fleet_cache_publisher
  lifecycle { destroy = true }
}
removed {
  from = vault_policy.fleet_cache_publisher
  lifecycle { destroy = true }
}
removed {
  from = vault_jwt_auth_backend_role.fleet_cache_publisher
  lifecycle { destroy = true }
}
removed {
  from = vault_jwt_auth_backend_role.fleet_cache_queue_publisher
  lifecycle { destroy = true }
}
