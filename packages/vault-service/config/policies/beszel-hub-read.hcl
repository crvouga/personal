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

# Periodic tokens must look themselves up (vault login) and renew themselves
# (personal-worker-auth timer); they are issued without the default policy.
path "auth/token/lookup-self" {
  capabilities = ["read"]
}

path "auth/token/renew-self" {
  capabilities = ["update"]
}
