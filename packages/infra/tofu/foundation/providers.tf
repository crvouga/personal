provider "railway" { token = var.railway_token }
provider "graphql" {
  url     = "https://backboard.railway.app/graphql/v2"
  headers = { Authorization = "Bearer ${var.railway_token}" }
}
provider "cloudflare" { api_token = var.cloudflare_api_token }
provider "github" {
  owner = "crvouga"
  token = var.github_token
}
provider "planetscale" {
  service_token_id = var.planetscale_service_token_id
  service_token    = var.planetscale_service_token
}
# Retired: configured only so the Neon project can leave state.
provider "neon" { api_key = var.neon_api_key }

provider "atlas" {}

# The same role, host and database local.database_url is assembled from; the
# provider takes the unencoded parts, so nothing needs percent-decoding.
provider "postgresql" {
  host            = planetscale_postgres_branch_role.openbao.access_host_url
  port            = 5432
  database        = planetscale_postgres_branch_role.openbao.database_name
  username        = planetscale_postgres_branch_role.openbao.username
  password        = planetscale_postgres_branch_role.openbao.password
  sslmode         = "require"
  superuser       = false
  connect_timeout = 30
}
