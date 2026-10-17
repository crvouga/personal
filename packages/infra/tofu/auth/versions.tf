terraform {
  required_version = "~> 1.13.0"
  required_providers {
    vault    = { source = "hashicorp/vault", version = "= 5.12.0" }
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
variable "keycloak_url" { type = string }
provider "keycloak" {
  url = var.keycloak_url
  # KEYCLOAK_URL, KEYCLOAK_CLIENT_ID, KEYCLOAK_CLIENT_SECRET supplied securely.
  client_timeout = 30
}
