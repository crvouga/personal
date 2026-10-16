output "config" {
  value = local.inventory
  precondition {
    condition     = alltrue([for service in local.inventory.services : try(service.railway.registry, null) == null])
    error_message = "All platform images must be public and pulled anonymously; private registry credentials are not allowed."
  }
}
