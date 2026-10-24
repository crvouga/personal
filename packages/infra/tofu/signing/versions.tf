terraform {
  required_version = "~> 1.13.0"
  required_providers {
    azurerm = { source = "hashicorp/azurerm", version = "= 5.11.0" }
    azapi   = { source = "Azure/azapi", version = "= 2.13.0" }
    github  = { source = "integrations/github", version = "= 6.13.0" }
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
}

# Authentication uses the operator's Azure CLI session, or explicitly supplied
# ARM_* credentials. Provider initialization must never register resources.
provider "azurerm" {
  features {}
  subscription_id                 = local.config.subscription_id
  tenant_id                       = local.config.tenant_id
  resource_provider_registrations = "none"
}

provider "azapi" {
  subscription_id            = local.config.subscription_id
  tenant_id                  = local.config.tenant_id
  skip_provider_registration = true
  enable_preflight           = false
}

provider "github" {
  owner = split("/", local.repository)[0]
}
