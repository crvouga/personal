output "config" {
  value = local.inventory
  precondition {
    condition     = alltrue([for service in local.inventory.services : try(service.railway.registry, null) == null])
    error_message = "All platform images must be public and pulled anonymously; private registry credentials are not allowed."
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
