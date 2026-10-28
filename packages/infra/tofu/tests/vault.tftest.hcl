mock_provider "vault" {
  mock_data "vault_kv_secret_v2" {
    defaults = { data = { NIX_CACHE_PRIVATE_KEY_PEM = "mock-existing-key" } }
  }
}
mock_provider "random" {}
mock_provider "tls" {}


run "reject_unsafe_auth_agent_id" {
  command = plan
  variables {
    auth_agent_credentials = {
      app_dev = {
        config = "dev", repository = "owner/app", subject = "repo:owner/app:ref:refs/heads/main"
      }
    }
  }
  expect_failures = [var.auth_agent_credentials]
}

run "auth_agent_credential_isolation" {
  command = plan
  variables {
    auth_agent_credentials = {
      app-dev = {
        config = "dev", repository = "owner/app", subject = "repo:owner/app:ref:refs/heads/main", generation = 2
      }
      app-prd = {
        config = "prd", repository = "owner/app", subject = "repo:owner/app:environment:production"
      }
    }
  }
  assert {
    condition = alltrue([for id, credential in var.auth_agent_credentials :
      vault_kv_secret_v2.auth_agent[id].name == "auth-relay-agents/${id}/${credential.config}" &&
      vault_policy.auth_agent[id].policy == "path \"secret/data/auth-relay-agents/${id}/${credential.config}\" {\n  capabilities = [\"read\"]\n}\n" &&
      vault_jwt_auth_backend_role.auth_agent[id].bound_claims.repository == credential.repository &&
      vault_jwt_auth_backend_role.auth_agent[id].bound_claims.sub == credential.subject &&
      vault_jwt_auth_backend_role.auth_agent[id].bound_claims_type == "string" &&
      vault_jwt_auth_backend_role.auth_agent[id].token_no_default_policy &&
      vault_jwt_auth_backend_role.auth_agent[id].token_max_ttl == 600 &&
      random_password.auth_agent[id].length == 48 && !random_password.auth_agent[id].special
    ])
    error_message = "Agent credentials must be independently generated in isolated documents with read-only exact-subject CI policies."
  }
  assert {
    condition = alltrue([for policy in ["ci-read", "personal-read", "dev-read"] :
      !strcontains(vault_policy.this[policy].policy, "auth-relay-agents") &&
      !strcontains(vault_policy.this[policy].policy, "path \"secret/data/*\"")
    ]) && random_password.auth_agent["app-dev"].keepers.generation == "2"
    error_message = "Shared application policies cannot expose registration credentials; rotation uses generation keepers."
  }
}

run "reject_auth_agent_repository_subject_mismatch" {
  command = plan
  variables {
    auth_agent_credentials = {
      app-dev = { config = "dev", repository = "owner/app", subject = "repo:attacker/app:ref:refs/heads/main" }
    }
  }
  expect_failures = [var.auth_agent_credentials]
}

run "reject_auth_agent_wildcard_subject" {
  command = plan
  variables {
    auth_agent_credentials = {
      app-prd = { config = "prd", repository = "owner/app", subject = "repo:owner/app:*" }
    }
  }
  expect_failures = [var.auth_agent_credentials]
}

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
      auth_console_database = {
        production    = "postgres://console-prd:secret@db.example.net/app?sslmode=verify-full"
        nonproduction = "postgres://console-dev:secret@db.example.net/app?sslmode=verify-full"
      }
    }
  }
}
# One override covers both realm states (auth-production / auth-nonproduction).
override_data {
  target = data.terraform_remote_state.auth_relay
  values = {
    outputs = {
      console_credentials = {
        AUTH_CONSOLE_CLIENT_ID     = "console-id"
        AUTH_CONSOLE_CLIENT_SECRET = "console-secret"
        AUTH_MANAGER_CLIENT_ID     = "manager-id"
        AUTH_MANAGER_CLIENT_SECRET = "manager-secret"
      }
    }
  }
}
override_data {
  target = data.terraform_remote_state.bootstrap
  values = { outputs = { root_token = "root-token" } }
}

variables {
  state_access_key   = "test-state-key"
  state_secret_key   = "test-state-secret"
  github_token       = "test-github-token"
  cloudflare_zone_id = "test-zone"
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
    dev = merge({ PORTFOLIO_GITHUB_TOKEN = "dev-token", TURBO_TOKEN = "retired-token", TURBO_API = "https://retired.invalid", TURBO_TEAM = "retired-team", TURBO_CACHE = "remote:rw" }, {
      for key in jsondecode(file("../modules/inventory/inventory.tf.json")).locals.inventory.vault.kv_keys : key.name => "test-${key.name}" if try(key.required, false) && !try(key.generated, false) && contains(key.configs, "dev")
    })
    prd = merge(
      { for key in jsondecode(file("../modules/inventory/inventory.tf.json")).locals.inventory.vault.kv_keys : key.name => "test-${key.name}" if try(key.required, false) && !try(key.generated, false) },
      { for name in toset(flatten([for service in jsondecode(file("../modules/inventory/inventory.tf.json")).locals.inventory.services : [for secret in try(service.secrets, []) : secret.name if !contains([for key in jsondecode(file("../modules/inventory/inventory.tf.json")).locals.inventory.vault.kv_keys : key.name if try(key.generated, false)], secret.name)]])) : name => "test-${name}" }
    )
  }
}

run "operator_credentials" {
  command = plan
  assert {
    condition = vault_kv_secret_v2.operator.name == "infra/operator" && alltrue([
      jsondecode(vault_kv_secret_v2.operator.data_json).TOFU_STATE_ACCESS_KEY == var.state_access_key,
      jsondecode(vault_kv_secret_v2.operator.data_json).TOFU_STATE_SECRET_KEY == var.state_secret_key,
      jsondecode(vault_kv_secret_v2.operator.data_json).TOFU_STATE_PASSPHRASE == var.state_passphrase,
      jsondecode(vault_kv_secret_v2.operator.data_json).GITHUB_TOKEN == var.github_token,
    ])
    error_message = "Existing CI credentials must be projected into the admin-only operator document."
  }
  assert {
    condition = alltrue([for config in ["dev", "prd"] : alltrue([
      for key in ["TOFU_STATE_ACCESS_KEY", "TOFU_STATE_SECRET_KEY", "TOFU_STATE_PASSPHRASE", "GITHUB_TOKEN"] :
      !contains(keys(jsondecode(vault_kv_secret_v2.personal[config].data_json)), key)
      ])]) && alltrue([
      for policy in ["personal-read", "ci-read", "dev-read"] :
      !strcontains(vault_policy.this[policy].policy, "secret/data/infra/") && !strcontains(vault_policy.this[policy].policy, "path \"*\"")
    ])
    error_message = "Runtime and CI read policies must not expose the operator document or state credentials."
  }
}

run "reject_empty_operator_credentials" {
  command = plan
  variables { state_access_key = "" }
  expect_failures = [vault_kv_secret_v2.operator]
}


run "auth_relay_credentials_are_projected" {
  command = plan
  assert {
    condition = alltrue([
      for config, url in { dev = "console-dev", prd = "console-prd" } :
      jsondecode(vault_kv_secret_v2.personal[config].data_json).AUTH_CONSOLE_CLIENT_ID == "console-id"
      && jsondecode(vault_kv_secret_v2.personal[config].data_json).AUTH_MANAGER_CLIENT_SECRET == "manager-secret"
      && strcontains(jsondecode(vault_kv_secret_v2.personal[config].data_json).AUTH_RELAY_DATABASE_URL, url)
    ])
    error_message = "Each Vault document must carry its own realm's console and manager credentials and its own console database URL."
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

run "zoomies_encryption_key_is_exactly_32_bytes_and_production_only" {
  command = plan
  assert {
    condition     = random_id.zoomies_encryption_key.byte_length == 32
    error_message = "Zoomies seals credentials with exactly 32 random bytes."
  }
  assert {
    condition     = contains(keys(jsondecode(vault_kv_secret_v2.personal["prd"].data_json)), "ZOOMIES_ENCRYPTION_KEY") && !contains(keys(jsondecode(vault_kv_secret_v2.personal["dev"].data_json)), "ZOOMIES_ENCRYPTION_KEY")
    error_message = "The Zoomies encryption key must be managed in production only."
  }
}

run "reject_missing_youtube_key" {
  command = plan
  variables {
    secrets = {
      dev = merge({ PORTFOLIO_GITHUB_TOKEN = "dev-token" }, {
        for key in jsondecode(file("../modules/inventory/inventory.tf.json")).locals.inventory.vault.kv_keys : key.name => "test-${key.name}" if try(key.required, false) && !try(key.generated, false) && contains(key.configs, "dev")
      })
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
      dev = merge({ PORTFOLIO_GITHUB_TOKEN = "dev-token" }, {
        for key in jsondecode(file("../modules/inventory/inventory.tf.json")).locals.inventory.vault.kv_keys : key.name => "test-${key.name}" if try(key.required, false) && !try(key.generated, false) && contains(key.configs, "dev")
      })
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
      dev = merge({ PORTFOLIO_GITHUB_TOKEN = "dev-token" }, {
        for key in jsondecode(file("../modules/inventory/inventory.tf.json")).locals.inventory.vault.kv_keys : key.name => "test-${key.name}" if try(key.required, false) && !try(key.generated, false) && contains(key.configs, "dev")
      })
      prd = { for name, value in merge(
        { for key in jsondecode(file("../modules/inventory/inventory.tf.json")).locals.inventory.vault.kv_keys : key.name => "test-${key.name}" if try(key.required, false) && !try(key.generated, false) },
        { for name in toset(flatten([for service in jsondecode(file("../modules/inventory/inventory.tf.json")).locals.inventory.services : [for secret in try(service.secrets, []) : secret.name if !contains([for key in jsondecode(file("../modules/inventory/inventory.tf.json")).locals.inventory.vault.kv_keys : key.name if try(key.generated, false)], secret.name)]])) : name => "test-${name}" }
      ) : name => name == "TMDB_API_READ_ACCESS_TOKEN" ? "  " : value }
    }
  }
  expect_failures = [vault_kv_secret_v2.personal["prd"]]
}

run "reject_missing_google_client_id" {
  command = plan
  variables {
    secrets = {
      dev = merge({ PORTFOLIO_GITHUB_TOKEN = "dev-token" }, {
        for key in jsondecode(file("../modules/inventory/inventory.tf.json")).locals.inventory.vault.kv_keys : key.name => "test-${key.name}" if try(key.required, false) && !try(key.generated, false) && contains(key.configs, "dev") && key.name != "GOOGLE_OAUTH_CLIENT_ID"
      })
      prd = merge(
        { for key in jsondecode(file("../modules/inventory/inventory.tf.json")).locals.inventory.vault.kv_keys : key.name => "test-${key.name}" if try(key.required, false) && !try(key.generated, false) },
        { for name in toset(flatten([for service in jsondecode(file("../modules/inventory/inventory.tf.json")).locals.inventory.services : [for secret in try(service.secrets, []) : secret.name if !contains([for key in jsondecode(file("../modules/inventory/inventory.tf.json")).locals.inventory.vault.kv_keys : key.name if try(key.generated, false)], secret.name)]])) : name => "test-${name}" }
      )
    }
  }
  expect_failures = [vault_kv_secret_v2.personal["dev"]]
}

run "reject_blank_google_client_secret" {
  command = plan
  variables {
    secrets = {
      dev = merge({ PORTFOLIO_GITHUB_TOKEN = "dev-token" }, {
        for key in jsondecode(file("../modules/inventory/inventory.tf.json")).locals.inventory.vault.kv_keys : key.name => "test-${key.name}" if try(key.required, false) && !try(key.generated, false) && contains(key.configs, "dev")
      })
      prd = merge(
        { for key in jsondecode(file("../modules/inventory/inventory.tf.json")).locals.inventory.vault.kv_keys : key.name => key.name == "GOOGLE_OAUTH_CLIENT_SECRET" ? "  " : "test-${key.name}" if try(key.required, false) && !try(key.generated, false) },
        { for name in toset(flatten([for service in jsondecode(file("../modules/inventory/inventory.tf.json")).locals.inventory.services : [for secret in try(service.secrets, []) : secret.name if !contains([for key in jsondecode(file("../modules/inventory/inventory.tf.json")).locals.inventory.vault.kv_keys : key.name if try(key.generated, false)], secret.name)]])) : name => "test-${name}" }
      )
    }
  }
  expect_failures = [vault_kv_secret_v2.personal["prd"]]
}

run "retired_cache_credentials_are_filtered_from_stale_inputs" {
  command = plan
  assert {
    condition = alltrue([for config in ["dev", "prd"] :
      jsondecode(vault_kv_secret_v2.personal[config].data_json).TURBO_CACHE == "local:rw" &&
      jsondecode(vault_kv_secret_v2.personal[config].data_json).TURBO_TELEMETRY_DISABLED == "1" &&
      jsondecode(vault_kv_secret_v2.personal[config].data_json).TURBO_LOG_ORDER == "auto" &&
      length(setintersection(toset(keys(jsondecode(vault_kv_secret_v2.personal[config].data_json))), toset(["TURBO_TOKEN", "TURBO_API", "TURBO_TEAM"]))) == 0
    ])
    error_message = "Stale secrets exports cannot restore retired credentials or remote caching."
  }
}
