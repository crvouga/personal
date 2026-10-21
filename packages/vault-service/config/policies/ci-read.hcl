# Read-only access for CI (GitHub Actions OIDC) to the personal secrets.
path "secret/data/personal/*" {
  capabilities = ["read"]
}

path "secret/metadata/personal/*" {
  capabilities = ["list", "read"]
}

# The OpenTofu Vault provider validates the token it is given. CI roles carry no
# default policy, so allow only the token to describe itself.
path "auth/token/lookup-self" {
  capabilities = ["read"]
}
