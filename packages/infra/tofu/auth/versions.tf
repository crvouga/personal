terraform {
  required_version = "~> 1.13.0"
  required_providers {
    keycloak = { source = "keycloak/keycloak", version = "= 5.9.0" }
  }
  backend "s3" {}
  encryption {
    key_provider "pbkdf2" "state" { passphrase = var.state_passphrase }
    method "aes_gcm" "state" { keys = key_provider.pbkdf2.state }
    state {
      method   = method.aes_gcm.state
      enforced = true
    }
    plan {
      method   = method.aes_gcm.state
      enforced = true
    }
    remote_state_data_sources {
      default { method = method.aes_gcm.state }
    }
  }
}
variable "state_passphrase" {
  type      = string
  sensitive = true
  validation {
    condition     = length(var.state_passphrase) >= 32
    error_message = "Use at least 32 characters for state encryption."
  }
}
variable "state_backend" { type = any }
# The identity service is private. Its admin API is reachable only through the
# Access-protected tunnel hostname, which admits the CI service token alone.
data "terraform_remote_state" "foundation" {
  backend = "s3"
  config  = merge(var.state_backend, { key = "foundation.tfstate" })
}
locals {
  admin = data.terraform_remote_state.foundation.outputs.auth_admin[var.instance]
}
provider "keycloak" {
  url           = local.admin.url
  client_id     = "admin-cli"
  username      = local.admin.username
  password      = local.admin.password
  realm         = "master"
  initial_login = true
  additional_headers = {
    "CF-Access-Client-Id"     = local.admin.access_client_id
    "CF-Access-Client-Secret" = local.admin.access_client_secret
  }
  client_timeout = 60
}
