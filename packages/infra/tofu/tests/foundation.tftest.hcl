mock_provider "railway" {
  mock_resource "railway_project" {
    defaults = {
      id = "12345678-1234-4234-8234-123456789012"
    }
  }
  mock_resource "railway_service" {
    defaults = { id = "12345678-1234-4234-8234-123456789014" }
  }
}
mock_provider "graphql" {}
mock_provider "cloudflare" {
  mock_resource "cloudflare_zone" {
    defaults = { id = "83db052d18159889dd290724ac7d52d9" }
  }
  mock_data "cloudflare_api_token_permission_groups_list" {
    defaults = { result = [{ id = "r2-write-permission", name = "Workers R2 Storage Bucket Item Write", scopes = [] }] }
  }
}
mock_provider "github" {
  mock_data "github_actions_secrets" {
    defaults = {
      secrets = [for name in ["DEPLOY_DISPATCH_TOKEN", "DOCKER_USERNAME", "DOCKER_PASSWORD", "DOPPLER_SERVICE_TOKEN", "GENEBYGENE_CLIENT_ID", "GENEBYGENE_CLIENT_SECRET", "JUNCTION_API_KEY", "PADDLE_API_KEY", "STRIPE_SECRET_KEY"] : {
        name       = name
        created_at = "2026-10-01T00:00:00Z"
        updated_at = "2026-10-01T00:00:00Z"
      }]
    }
  }
}
mock_provider "planetscale" {}
mock_provider "neon" {}
mock_provider "atlas" {}
mock_provider "postgresql" {}
mock_provider "time" {}
mock_provider "random" {}

# The service module has its own tests. The Railway mock cannot synthesize
# the computed ID inside the configured default_environment object.
override_module {
  target  = module.vault_service
  outputs = { id = "12345678-1234-4234-8234-123456789014" }
}

variables {
  railway_token                = "test-railway-token"
  cloudflare_api_token         = "test-cloudflare-token"
  github_token                 = "test-github-token"
  cloudflare_zone_id           = "test-zone-id"
  cloudflare_account_id        = "test-account-id"
  planetscale_service_token_id = "test-planetscale-token-id"
  planetscale_service_token    = "test-planetscale-token"
  state_access_key             = "test-state-key"
  state_secret_key             = "test-state-secret"
  vault_inputs                 = jsonencode({ secrets = { prd = {} }, admin_passwords = {} })
}

run "complete_adoption_plan" {
  command = plan
  assert {
    condition     = planetscale_postgres_branch.openbao.cluster_size == "PS_5_AWS_ARM" && planetscale_postgres_branch.openbao.region == "us-east" && planetscale_postgres_branch.openbao.major_version == "18"
    error_message = "The database must stay the smallest single-region network-attached size."
  }
  assert {
    condition     = planetscale_postgres_branch_role.openbao.inherited_roles == toset(["postgres"])
    error_message = "The database role must inherit the built-in owner role so schema changes keep working."
  }
  assert {
    condition     = length(github_repository_file.publish) == 15
    error_message = "Foundation adoption must preserve a publisher for every application repository."
  }
  assert {
    condition     = length(github_actions_secret.repository) == 31 && length(output.unavailable_repository_secrets) == 0
    error_message = "GitHub-only secrets must be adopted without a duplicate plaintext Vault input."
  }
}

run "fleet_database_is_isolated_in_its_own_schema" {
  command = plan
  assert {
    condition     = postgresql_schema.fleet.name == "fleet" && postgresql_schema.fleet.if_not_exists
    error_message = "OpenTofu's PostgreSQL provider must create the empty fleet schema, which Atlas needs to exist already."
  }
  assert {
    condition     = endswith(atlas_schema.fleet.url, "&search_path=fleet") && !strcontains(atlas_schema.openbao.url, "search_path=fleet")
    error_message = "The fleet Atlas resource must be scoped to the fleet schema; without search_path Atlas diffs and drops every schema in the shared database."
  }
  assert {
    condition     = atlas_schema.fleet.hcl == file("${path.module}/../../../fleet-api/schema.hcl")
    error_message = "The fleet schema must be read from packages/fleet-api/schema.hcl."
  }
  assert {
    condition     = length(regexall("(?m)^schema \"", atlas_schema.fleet.hcl)) == 1 && strcontains(atlas_schema.fleet.hcl, "schema \"fleet\" {}")
    error_message = "The fleet HCL must declare only the fleet schema."
  }
  assert {
    condition     = atlas_schema.fleet.dev_url == var.schema_dev_url
    error_message = "Atlas must plan against the disposable dev database."
  }
}

run "missing_secrets_skip_only_their_resources" {
  command = plan
  override_data {
    target = data.github_actions_secrets.repository["mockingbird"]
    values = { secrets = [] }
  }
  assert {
    condition     = length(github_actions_secret.repository) == 26 && length(output.unavailable_repository_secrets) == 5
    error_message = "Missing Mockingbird credentials must not block unrelated foundation resources or other repositories' secrets."
  }
}

run "unrelated_invalid_vault_values_do_not_block_adoption" {
  command = plan
  variables {
    vault_inputs = jsonencode({ secrets = { prd = { DOCKER_PASSWORD = "  " } }, admin_passwords = {} })
  }
  assert {
    condition     = length(github_actions_secret.repository) == 31
    error_message = "GitHub secret adoption must not depend on the content of unrelated Vault fields."
  }
}

run "pickflix_database_is_isolated" {
  command = plan
  assert {
    condition     = postgresql_schema.pickflix.name == "pickflix" && postgresql_schema.pickflix.if_not_exists && endswith(atlas_schema.pickflix.url, "&search_path=pickflix")
    error_message = "Pickflix must never manage objects outside its schema in the shared database."
  }
  assert {
    condition     = atlas_schema.pickflix.hcl == file("${path.module}/pickflix-schema.hcl") && length(regexall("(?m)^schema \"", atlas_schema.pickflix.hcl)) == 1
    error_message = "Pickflix tables and sessions must be owned by the local, single-schema Atlas definition."
  }
  assert {
    condition     = strcontains(github_repository_file.publish["pickflix-v1"].content, "ci.yml@main") && strcontains(github_repository_file.publish["pickflix-v1"].content, "- master") && github_repository_file.publish["pickflix-v1"].file == ".github/workflows/publish-image.yml"
    error_message = "Adopt the existing Pickflix publisher in place and build master through the workspace workflow."
  }
}

run "pickflix_publisher_builds_on_adoption" {
  command = plan
  assert {
    condition     = !strcontains(github_repository_file.publish["pickflix-v1"].commit_message, "[skip ci]") && strcontains(github_repository_file.publish["pickflix-v1"].content, "id-token: write") && strcontains(github_repository_file.publish["pickflix-v1"].content, "CALLER_GITHUB_TOKEN")
    error_message = "Pickflix publisher adoption must trigger a build with the reusable workflow's permissions and registry credentials."
  }
}
