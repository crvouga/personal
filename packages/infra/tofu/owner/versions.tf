terraform {
  required_version = "~> 1.13.0"
  required_providers {
    restapi = { source = "Mastercard/restapi", version = "= 3.0.0" }
  }
  backend "local" {}
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
}
