terraform {
  required_version = "~> 1.13.0"
  required_providers {
    neon        = { source = "kislerdm/neon", version = "= 0.18.0" }
    railway     = { source = "terraform-community-providers/railway", version = "= 0.6.2" }
    graphql     = { source = "sullivtr/graphql", version = "= 2.6.2" }
    cloudflare  = { source = "cloudflare/cloudflare", version = "= 5.26.0" }
    github      = { source = "integrations/github", version = "= 6.13.0" }
    planetscale = { source = "planetscale/planetscale", version = "= 1.12.0" }
    atlas       = { source = "ariga/atlas", version = "= 0.10.3" }
    time        = { source = "hashicorp/time", version = "= 0.13.1" }
    random      = { source = "hashicorp/random", version = "= 3.8.1" }
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
