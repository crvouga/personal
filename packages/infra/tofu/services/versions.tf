terraform {
  required_version = "~> 1.13.0"
  required_providers {
    railway    = { source = "terraform-community-providers/railway", version = "= 0.6.2" }
    graphql    = { source = "sullivtr/graphql", version = "= 2.6.2" }
    cloudflare = { source = "cloudflare/cloudflare", version = "= 5.26.0" }
    vault      = { source = "hashicorp/vault", version = "= 5.12.0" }
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
