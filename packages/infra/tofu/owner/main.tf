# One immutable owner operation per private encrypted execution state. The local
# browser transport accepts writes only during application of the reviewed plan.
module "inventory" { source = "../modules/inventory" }

variable "owner_operation" {
  type    = object({ action = string, domain = string, nameservers = list(string) })
  default = null
  validation {
    condition     = var.owner_operation == null ? true : contains(["disable-dnssec", "delegate", "unlock", "request-code"], var.owner_operation.action)
    error_message = "Unsupported owner operation."
  }
}

variable "owner_bridge_url" {
  type    = string
  default = "http://127.0.0.1:1"
  validation {
    condition     = can(regex("^http://127\\.0\\.0\\.1:[0-9]+$", var.owner_bridge_url))
    error_message = "Owner transport must use an IPv4 loopback endpoint."
  }
}

variable "owner_bridge_token" {
  type      = string
  sensitive = true
  default   = ""
}

locals {
  operation_id = var.owner_operation == null ? "" : sha256(jsonencode(var.owner_operation))
  payload      = var.owner_operation == null ? null : merge(var.owner_operation, { id = local.operation_id })
}

provider "restapi" {
  uri                   = var.owner_bridge_url
  bearer_token          = var.owner_bridge_token
  create_returns_object = true
  debug                 = false
  timeout               = 240
  retries { max_retries = 0 }
}

resource "restapi_object" "squarespace_owner_operation" {
  count     = var.owner_operation == null ? 0 : 1
  object_id = local.operation_id
  path      = "/operations"
  data      = jsonencode(local.payload)

  create_method  = "POST"
  read_method    = "GET"
  read_path      = "/operations/${local.operation_id}"
  update_method  = "GET"
  update_path    = "/operations/${local.operation_id}"
  update_data    = "{}"
  destroy_method = "GET"
  destroy_path   = "/operations/${local.operation_id}"
  destroy_data   = "{}"
  debug          = false

  ignore_all_server_changes = true
  lifecycle {
    prevent_destroy = true
    precondition {
      condition     = contains(keys(module.inventory.config.domains), var.owner_operation.domain)
      error_message = "Owner operation domain is outside the canonical OpenTofu inventory."
    }
    precondition {
      condition = contains(["disable-dnssec", "delegate"], var.owner_operation.action) ? try(
        module.inventory.config.domains[var.owner_operation.domain].availability == "best-effort" &&
      module.inventory.config.domains[var.owner_operation.domain].dns_migration == "retire-unused", false) : true
      error_message = "Source DNS owner changes are restricted to explicitly retired unused domains."
    }
    postcondition {
      condition     = self.create_response == null || self.create_response == "" ? true : try(jsondecode(self.create_response).status == "accepted", false)
      error_message = "Owner operation was not verified. Preserve its intent and inspect the private evidence before retrying."
    }
  }
}
