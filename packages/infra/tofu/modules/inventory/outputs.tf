output "config" {
  value = local.inventory
  precondition {
    condition = alltrue([for alias in local.inventory.aliases :
      contains([for service in local.inventory.services : service.id if try(service.kind, "railway") == "railway" && !try(service.standalone, false)], alias.service) &&
      try(local.inventory.domains[alias.zone].manage_zone, false) &&
      (alias.hostname == alias.zone || endswith(alias.hostname, ".${alias.zone}"))
      ]) && length(distinct(concat(
        [for service in local.inventory.services : service.hostname],
        [for alias in local.inventory.aliases : alias.hostname]
    ))) == length(local.inventory.services) + length(local.inventory.aliases)
    error_message = "Additional domains must be unique, belong to a managed zone and attach to an existing Railway service."
  }
  precondition {
    condition     = alltrue([for service in local.inventory.services : try(service.railway.registry, null) == null])
    error_message = "All platform images must be public and pulled anonymously; private registry credentials are not allowed."
  }
  precondition {
    condition     = local.inventory.auth_relay.enabled || !local.inventory.auth_relay.live
    error_message = "auth_relay.live requires auth_relay.enabled."
  }
  precondition {
    condition = alltrue([for instance in values(local.inventory.auth_relay.instances) : contains(local.inventory.vault.kv.configs, instance.vault_config)]) && alltrue(flatten([for instance in values(local.inventory.auth_relay.instances) : [
      for name in [instance.google_client_id_key, instance.google_client_secret_key, instance.setup_token_key] : anytrue([
        for key in local.inventory.vault.kv_keys : key.name == name && try(key.required, false) && contains(key.configs, instance.vault_config)
      ])
    ]]))
    error_message = "Auth relay Google and setup credential fields must be required Vault registry keys for every declared environment."
  }
}
