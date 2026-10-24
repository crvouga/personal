# Credential/access metadata only. Application registrations and callback scopes
# remain runtime data in the relay database, approved by an operator.
variable "auth_agent_credentials" {
  type = map(object({
    config     = string
    repository = string
    subject    = string
    generation = optional(number, 1)
  }))
  default     = {}
  description = "Isolated agent credentials, each bound to one exact GitHub repository and OIDC subject. Persist the complete map in TOFU_VAULT_INPUTS; never put raw credentials here. Increment generation for rotation, then update the existing relay grant fingerprint."
  validation {
    condition = alltrue([for id, credential in var.auth_agent_credentials :
      can(regex("^[a-z0-9][a-z0-9-]{0,62}$", id)) &&
      contains(["dev", "prd"], credential.config) &&
      can(regex("^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$", credential.repository)) &&
      startswith(credential.subject, "repo:${credential.repository}:") &&
      !strcontains(credential.subject, "*") &&
      credential.generation >= 1 && floor(credential.generation) == credential.generation
    ])
    error_message = "Use a safe credential id, dev/prd, an exact owner/repo and matching exact GitHub OIDC subject, and a positive integer generation."
  }
}

resource "random_password" "auth_agent" {
  for_each = var.auth_agent_credentials
  length   = 48
  special  = false
  keepers  = { generation = each.value.generation }
}

resource "vault_kv_secret_v2" "auth_agent" {
  for_each = var.auth_agent_credentials
  mount    = vault_mount.secret.path
  name     = "auth-relay-agents/${each.key}/${each.value.config}"
  data_json = jsonencode({
    AUTH_RELAY_AGENT_TOKEN = random_password.auth_agent[each.key].result
  })
  lifecycle { prevent_destroy = true }
}

resource "vault_policy" "auth_agent" {
  for_each = var.auth_agent_credentials
  name     = "auth-relay-agent-${each.key}"
  policy   = <<-HCL
    path "${vault_mount.secret.path}/data/${vault_kv_secret_v2.auth_agent[each.key].name}" {
      capabilities = ["read"]
    }
  HCL
}

resource "vault_jwt_auth_backend_role" "auth_agent" {
  for_each                = var.auth_agent_credentials
  backend                 = vault_jwt_auth_backend.github.path
  role_name               = "auth-relay-agent-${each.key}"
  role_type               = "jwt"
  user_claim              = "sub"
  bound_audiences         = [local.vault_addr]
  bound_claims_type       = "string"
  bound_claims            = { repository = each.value.repository, sub = each.value.subject }
  token_policies          = [vault_policy.auth_agent[each.key].name]
  token_ttl               = 300
  token_max_ttl           = 600
  token_no_default_policy = true
}

output "auth_agent_credentials" {
  description = "Nonsecret onboarding coordinates and fingerprints. Approve scopes in the relay console; no raw token output exists."
  value = { for id, credential in var.auth_agent_credentials : id => {
    path       = "${vault_mount.secret.path}/${vault_kv_secret_v2.auth_agent[id].name}"
    config     = credential.config
    role       = vault_jwt_auth_backend_role.auth_agent[id].role_name
    token_hash = nonsensitive(sha256(random_password.auth_agent[id].result))
  } }
}
