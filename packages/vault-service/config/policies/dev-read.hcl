# Shared application development reads must not include operator credentials,
# fleet enrollment material or isolated auth registration credentials.
path "secret/data/personal/*" {
  capabilities = ["read"]
}

path "secret/metadata/personal/*" {
  capabilities = ["list", "read"]
}
