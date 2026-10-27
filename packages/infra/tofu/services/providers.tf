provider "railway" { token = var.railway_token }
provider "graphql" {
  url     = "https://backboard.railway.app/graphql/v2"
  headers = { Authorization = "Bearer ${var.railway_token}" }
}
provider "cloudflare" { api_token = var.cloudflare_api_token }
provider "vault" {
  address          = local.vault_addr
  token            = data.terraform_remote_state.bootstrap.outputs.root_token
  skip_child_token = true
}
