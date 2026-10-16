mock_provider "vault" {}
mock_provider "random" {}

# The remote states hold real credentials; the plan only needs their shape.
override_data {
  target = data.terraform_remote_state.foundation
  values = {
    outputs = {
      buckets              = { development = "dev-bucket", production = "prd-bucket" }
      r2_access_key_id     = "r2-key"
      r2_secret_access_key = "r2-secret"
      router_token         = "router-token"
      database_url         = "postgres://owner:secret@db.example.net/app?sslmode=require"
    }
  }
}
override_data {
  target = data.terraform_remote_state.bootstrap
  values = { outputs = { root_token = "root-token" } }
}

variables {
  state_backend = {
    bucket                      = "test-state"
    region                      = "auto"
    skip_credentials_validation = true
    skip_region_validation      = true
    skip_requesting_account_id  = true
    skip_metadata_api_check     = true
  }
  cloudflare_account_id = "test-account-id"
  admin_passwords       = { crvouga = "test-password" }
  secrets = {
    dev = { PORTFOLIO_GITHUB_TOKEN = "dev-token" }
    prd = merge(
      { for key in jsondecode(file("../modules/inventory/inventory.tf.json")).locals.inventory.vault.kv_keys : key.name => "test-${key.name}" if try(key.required, false) && !try(key.generated, false) },
      { for name in toset(flatten([for service in jsondecode(file("../modules/inventory/inventory.tf.json")).locals.inventory.services : [for secret in try(service.secrets, []) : secret.name if !contains([for key in jsondecode(file("../modules/inventory/inventory.tf.json")).locals.inventory.vault.kv_keys : key.name if try(key.generated, false)], secret.name)]])) : name => "test-${name}" }
    )
  }
  fleet_age_keys = {
    ci  = "AGE-SECRET-KEY-CI"
    web = "AGE-SECRET-KEY-WEB"
  }
}

run "fleet_api_credentials" {
  command = plan
  assert {
    condition     = toset(keys(random_password.fleet_role_token)) == toset(["ci", "web", "cache", "netboot", "devbox"]) && alltrue([for token in values(random_password.fleet_role_token) : token.length == 48 && !token.special])
    error_message = "Every fleet role needs its own 48 character alphanumeric API token."
  }
  assert {
    condition     = contains(keys(jsondecode(vault_kv_secret_v2.personal["prd"].data_json)), "FLEET_ADMIN_TOKEN") && contains(keys(jsondecode(vault_kv_secret_v2.personal["prd"].data_json)), "FLEET_SESSION_SECRET")
    error_message = "The fleet API reads its admin token and session secret from the production document."
  }
  assert {
    condition = (
      jsondecode(jsondecode(vault_kv_secret_v2.personal["prd"].data_json).FLEET_ROLE_TOKEN_HASHES) ==
      { for role, token in random_password.fleet_role_token : role => sha256(token.result) }
    ) && toset(keys(jsondecode(jsondecode(vault_kv_secret_v2.personal["prd"].data_json).FLEET_ROLE_TOKEN_HASHES))) == toset(["ci", "web", "cache", "netboot", "devbox"])
    error_message = "The fleet API must receive only the SHA-256 of each role token."
  }
  assert {
    condition     = alltrue([for token in values(random_password.fleet_role_token) : !strcontains(jsondecode(vault_kv_secret_v2.personal["prd"].data_json).FLEET_ROLE_TOKEN_HASHES, token.result)])
    error_message = "A raw role token must never be written to the production document."
  }
  assert {
    condition     = !contains(keys(jsondecode(vault_kv_secret_v2.personal["dev"].data_json)), "FLEET_ADMIN_TOKEN")
    error_message = "Fleet API credentials exist in production only."
  }
  assert {
    condition = alltrue([
      for role in keys(vault_kv_secret_v2.fleet) :
      jsondecode(vault_kv_secret_v2.fleet[role].data_json).api_token == random_password.fleet_role_token[role].result
      && jsondecode(vault_kv_secret_v2.fleet[role].data_json).age_key == var.fleet_age_keys[role]
    ]) && length(vault_kv_secret_v2.fleet) == 2
    error_message = "Each fleet role document carries its age key and the raw API token whose hash the service holds."
  }
}

run "generated_application_credentials" {
  command = plan
  assert {
    condition     = toset(keys(random_password.application)) == toset([for key in jsondecode(file("../modules/inventory/inventory.tf.json")).locals.inventory.vault.kv_keys : key.name if try(key.generated, false)]) && alltrue([for password in values(random_password.application) : password.length == 48 && !password.special])
    error_message = "Inventory-generated application secrets must use independent 48 character values."
  }
  assert {
    condition     = alltrue(flatten([for config in ["dev", "prd"] : [for key in jsondecode(file("../modules/inventory/inventory.tf.json")).locals.inventory.vault.kv_keys : contains(keys(jsondecode(vault_kv_secret_v2.personal[config].data_json)), key.name) == contains(key.configs, config) if try(key.generated, false)]]))
    error_message = "Generated application secrets must appear only in their inventory configurations."
  }
}

run "reject_missing_youtube_key" {
  command = plan
  variables {
    secrets = {
      dev = { PORTFOLIO_GITHUB_TOKEN = "dev-token" }
      prd = { for name, value in merge(
        { for key in jsondecode(file("../modules/inventory/inventory.tf.json")).locals.inventory.vault.kv_keys : key.name => "test-${key.name}" if try(key.required, false) && !try(key.generated, false) },
        { for name in toset(flatten([for service in jsondecode(file("../modules/inventory/inventory.tf.json")).locals.inventory.services : [for secret in try(service.secrets, []) : secret.name if !contains([for key in jsondecode(file("../modules/inventory/inventory.tf.json")).locals.inventory.vault.kv_keys : key.name if try(key.generated, false)], secret.name)]])) : name => "test-${name}" }
      ) : name => value if name != "YOUTUBE_API_KEY" }
    }
  }
  expect_failures = [vault_kv_secret_v2.personal["prd"]]
}

run "reject_missing_resend_key" {
  command = plan
  variables {
    secrets = {
      dev = { PORTFOLIO_GITHUB_TOKEN = "dev-token" }
      prd = { for name, value in merge(
        { for key in jsondecode(file("../modules/inventory/inventory.tf.json")).locals.inventory.vault.kv_keys : key.name => "test-${key.name}" if try(key.required, false) && !try(key.generated, false) },
        { for name in toset(flatten([for service in jsondecode(file("../modules/inventory/inventory.tf.json")).locals.inventory.services : [for secret in try(service.secrets, []) : secret.name if !contains([for key in jsondecode(file("../modules/inventory/inventory.tf.json")).locals.inventory.vault.kv_keys : key.name if try(key.generated, false)], secret.name)]])) : name => "test-${name}" }
      ) : name => value if name != "RESEND_API_KEY" }
    }
  }
  expect_failures = [vault_kv_secret_v2.personal["prd"]]
}

run "reject_blank_service_credential" {
  command = plan
  variables {
    secrets = {
      dev = { PORTFOLIO_GITHUB_TOKEN = "dev-token" }
      prd = { for name, value in merge(
        { for key in jsondecode(file("../modules/inventory/inventory.tf.json")).locals.inventory.vault.kv_keys : key.name => "test-${key.name}" if try(key.required, false) && !try(key.generated, false) },
        { for name in toset(flatten([for service in jsondecode(file("../modules/inventory/inventory.tf.json")).locals.inventory.services : [for secret in try(service.secrets, []) : secret.name if !contains([for key in jsondecode(file("../modules/inventory/inventory.tf.json")).locals.inventory.vault.kv_keys : key.name if try(key.generated, false)], secret.name)]])) : name => "test-${name}" }
      ) : name => name == "TMDB_API_READ_ACCESS_TOKEN" ? "  " : value }
    }
  }
  expect_failures = [vault_kv_secret_v2.personal["prd"]]
}
