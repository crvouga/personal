terraform {
  required_version = "~> 1.13.0"
  required_providers {
    vault  = { source = "hashicorp/vault", version = "= 5.12.0" }
    random = { source = "hashicorp/random", version = "= 3.8.1" }
    tls    = { source = "hashicorp/tls", version = "= 4.1.0" }
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
