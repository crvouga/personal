# Railway never returns registry credentials through serviceInstance. Keep
# this write-only setting separate so ordinary settings retain drift checks.
variable "registry_password" {
  type      = string
  sensitive = true
  default   = null
}

locals {
  registry_mutation = <<-GRAPHQL
    mutation RegistryCredentials($serviceId: String!, $environmentId: String!, $credentials: RegistryCredentialsInput!) {
      serviceInstanceUpdate(serviceId: $serviceId, environmentId: $environmentId, input: {
        registryCredentials: $credentials
      })
    }
  GRAPHQL
}

resource "graphql_mutation" "registry_credentials" {
  count = try(var.service.railway.registry, null) == null ? 0 : 1
  mutation_variables = {
    serviceId     = railway_service.this.id
    environmentId = var.environment_id
    credentials = sensitive(jsonencode({
      username = var.service.railway.registry.username
      password = var.registry_password
    }))
  }
  read_query_variables = {
    serviceId     = railway_service.this.id
    environmentId = var.environment_id
  }
  compute_mutation_keys            = {}
  enable_remote_state_verification = false
  create_mutation                  = local.registry_mutation
  update_mutation                  = local.registry_mutation
  read_query                       = <<-GRAPHQL
    query RegistryCredentials($serviceId: String!, $environmentId: String!) {
      serviceInstance(serviceId: $serviceId, environmentId: $environmentId) {
        serviceId
        environmentId
      }
    }
  GRAPHQL
  delete_mutation                  = <<-GRAPHQL
    mutation ClearRegistryCredentials($serviceId: String!, $environmentId: String!) {
      serviceInstanceUpdate(serviceId: $serviceId, environmentId: $environmentId, input: {
        registryCredentials: null
      })
    }
  GRAPHQL
  delete_mutation_variables = {
    serviceId     = railway_service.this.id
    environmentId = var.environment_id
  }
  lifecycle {
    precondition {
      condition     = var.registry_password == null ? false : length(trimspace(var.registry_password)) > 0
      error_message = "A private image requires its declared registry password from production Vault."
    }
  }
}
