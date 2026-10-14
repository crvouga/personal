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
