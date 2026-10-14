module "inventory" { source = "../modules/inventory" }
locals {
  config        = module.inventory.config
  vault         = local.config.vault
  vault_addr    = "https://${local.vault.hostname}"
  router_values = { for key, password in random_password.router : key => lookup(var.secrets["prd"], key, password.result) }
  # Roles that may enroll without a person approving them in the fleet dashboard.
  fleet_roles = ["ci", "web", "cache", "netboot", "devbox"]
  # The fleet API holds only the SHA-256 of each role token; nodes hold the raw token.
  fleet_values = {
    FLEET_ADMIN_TOKEN       = random_password.fleet_admin.result
    FLEET_SESSION_SECRET    = random_password.fleet_session.result
    FLEET_ROLE_TOKEN_HASHES = jsonencode({ for role, token in random_password.fleet_role_token : role => sha256(token.result) })
  }
}

data "terraform_remote_state" "foundation" {
  backend = "s3"
  config  = merge(var.state_backend, { key = "foundation.tfstate" })
}
data "terraform_remote_state" "bootstrap" {
  backend = "s3"
  config  = merge(var.state_backend, { key = "bootstrap.tfstate" })
}

provider "vault" {
  address          = local.vault_addr
  token            = data.terraform_remote_state.bootstrap.outputs.root_token
  skip_child_token = true
}

resource "vault_mount" "secret" {
  path    = local.vault.kv.mount
  type    = "kv"
  options = { version = "2" }
  lifecycle { prevent_destroy = true }
}

resource "vault_policy" "this" {
  for_each = { for policy in local.vault.policies : policy.name => policy }
  name     = each.key
  policy   = file("${path.module}/../../../..//${each.value.file}")
}

resource "vault_jwt_auth_backend" "github" {
  path               = local.vault.auth.jwt.path
  oidc_discovery_url = "https://token.actions.githubusercontent.com"
  bound_issuer       = "https://token.actions.githubusercontent.com"
  lifecycle { prevent_destroy = true }
}

resource "vault_jwt_auth_backend_role" "github" {
  for_each          = { for role in local.vault.auth.jwt.roles : role.name => role }
  backend           = vault_jwt_auth_backend.github.path
  role_name         = each.key
  role_type         = "jwt"
  user_claim        = each.value.user_claim
  bound_audiences   = [local.vault_addr]
  bound_claims_type = "glob"
  bound_claims = merge({ repository = "${local.config.github.org}/*" },
    try(each.value.bound_ref, null) == null ? {} : { ref = each.value.bound_ref },
  try(each.value.bound_claims, {}))
  token_policies          = [each.value.policy]
  token_ttl               = parseint(trimsuffix(each.value.ttl, "m"), 10) * 60
  token_max_ttl           = parseint(trimsuffix(each.value.max_ttl, "m"), 10) * 60
  token_no_default_policy = each.value.no_default_policy
}

resource "vault_auth_backend" "userpass" {
  type = "userpass"
  lifecycle { prevent_destroy = true }
}
resource "vault_generic_endpoint" "admin" {
  for_each             = { for user in local.vault.auth.userpass.users : user.username => user }
  path                 = "auth/${vault_auth_backend.userpass.path}/users/${each.key}"
  ignore_absent_fields = true
  data_json = jsonencode(merge({
    token_policies          = [each.value.policy]
    token_period            = 768 * 60 * 60
    token_no_default_policy = true
  }, contains(keys(var.admin_passwords), each.key) ? { password = var.admin_passwords[each.key] } : {}))
  lifecycle {
    prevent_destroy = true
    precondition {
      condition     = !each.value.password_required || contains(keys(var.admin_passwords), each.key)
      error_message = "Supply the current password for every administrator marked password_required."
    }
  }
}

resource "vault_token" "runtime" {
  policies          = [one(local.vault.tokens).policy]
  display_name      = one(local.vault.tokens).name
  period            = one(local.vault.tokens).period
  renewable         = true
  no_default_policy = true
  no_parent         = true
  depends_on        = [vault_policy.this]
  lifecycle { prevent_destroy = true }
}

resource "random_password" "turbo" {
  length  = 48
  special = false
}
resource "random_password" "fleet_admin" {
  length  = 48
  special = false
}
resource "random_password" "fleet_session" {
  length  = 48
  special = false
}
resource "random_password" "fleet_role_token" {
  for_each = toset(local.fleet_roles)
  length   = 48
  special  = false
}
resource "random_password" "router" {
  for_each = toset(one(local.config.tunnels).secrets)
  length   = 48
  special  = false
}

resource "vault_kv_secret_v2" "personal" {
  for_each = toset(local.vault.kv.configs)
  mount    = vault_mount.secret.path
  name     = "${local.vault.kv.project}/${each.key}"
  data_json = jsonencode(merge(
    { TURBO_TOKEN = random_password.turbo.result },
    var.secrets[each.key],
    each.key == "prd" ? local.router_values : {},
    each.key == "prd" ? local.fleet_values : {},
    each.key == "prd" ? {
      INITIAL_PASSWORD = local.router_values["9ROUTER_PASSWORD"]
      JWT_SECRET       = local.router_values["9ROUTER_JWT_SECRET"]
      API_KEY_SECRET   = local.router_values["9ROUTER_API_KEY_SECRET"]
      MACHINE_ID_SALT  = local.router_values["9ROUTER_MACHINE_ID_SALT"]
    } : {},
    {
      TURBO_API                = "https://${one([for service in local.config.services : service.hostname if service.id == "turborepo"])}"
      TURBO_TEAM               = "local"
      TURBO_CACHE              = "remote:rw"
      TURBO_LOG_ORDER          = "auto"
      TURBO_TELEMETRY_DISABLED = "1"
      S3_ENDPOINT              = "https://${var.cloudflare_account_id}.r2.cloudflarestorage.com"
      S3_REGION                = "auto"
      S3_BUCKET                = data.terraform_remote_state.foundation.outputs.buckets[each.key == "dev" ? "development" : "production"]
      S3_ACCESS_KEY_ID         = data.terraform_remote_state.foundation.outputs.r2_access_key_id
      S3_SECRET_ACCESS_KEY     = data.terraform_remote_state.foundation.outputs.r2_secret_access_key
      VAULT_TOKEN              = vault_token.runtime.client_token
      CLOUDFLARE_ACCOUNT_ID    = var.cloudflare_account_id
      "9ROUTER_TUNNEL_TOKEN"   = data.terraform_remote_state.foundation.outputs.router_token
      DATABASE_URL             = data.terraform_remote_state.foundation.outputs.database_url
    }
  ))
  lifecycle {
    prevent_destroy = true
    precondition {
      condition = alltrue([for key in local.vault.kv_keys :
        contains(keys(var.secrets[each.key]), key.name)
        if try(key.required, false) && contains(key.configs, each.key) && key.name == "PORTFOLIO_GITHUB_TOKEN"
      ])
      error_message = "Supply PORTFOLIO_GITHUB_TOKEN in each config's secrets input."
    }
  }
}

# Per-role secrets for packages/fleet. A new node of a role receives its age key
# and its fleet API token (the raw value whose SHA-256 is in FLEET_ROLE_TOKEN_HASHES)
# from a single-use wrapped read of this document (fleet-node.sh --token-file).
resource "vault_kv_secret_v2" "fleet" {
  for_each = nonsensitive(toset(keys(var.fleet_age_keys)))
  mount    = vault_mount.secret.path
  name     = "fleet/${each.key}"
  data_json = jsonencode({
    age_key   = var.fleet_age_keys[each.key]
    api_token = random_password.fleet_role_token[each.key].result
  })
  lifecycle { prevent_destroy = true }
}
