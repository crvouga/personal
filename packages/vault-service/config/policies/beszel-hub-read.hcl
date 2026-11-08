# Beszel hub node: everything personal-read grants, plus its isolated Cloudflare
# tunnel connector credential (KV v2 mount: secret).
path "secret/data/personal/*" {
  capabilities = ["read"]
}

path "secret/metadata/personal/*" {
  capabilities = ["list", "read"]
}

path "secret/data/beszel/tunnel" {
  capabilities = ["read"]
}
