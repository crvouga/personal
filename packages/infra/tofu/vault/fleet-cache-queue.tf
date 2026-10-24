# Queue publications use the GitHub-owned queue ref, never a pull-request head.
resource "vault_jwt_auth_backend_role" "fleet_cache_queue_publisher" {
  backend           = vault_jwt_auth_backend.github.path
  role_name         = "fleet-cache-queue-publisher"
  role_type         = "jwt"
  user_claim        = "sub"
  bound_audiences   = [local.vault_addr]
  bound_claims_type = "glob"
  bound_claims = {
    repository   = local.config.github.infra_repo
    ref          = "refs/heads/gh-readonly-queue/main/*"
    workflow_ref = "${local.config.github.infra_repo}/.github/workflows/fleet-cache.yml@refs/heads/gh-readonly-queue/main/*"
  }
  token_policies          = [vault_policy.fleet_cache_publisher.name]
  token_ttl               = 600
  token_max_ttl           = 600
  token_no_default_policy = true
}
