# Read-only access for personal app runtime tokens (KV v2 mount: secret).
path "secret/data/personal/*" {
  capabilities = ["read"]
}

path "secret/metadata/personal/*" {
  capabilities = ["list", "read"]
}

# Periodic tokens must look themselves up (vault login) and renew themselves
# (personal-worker-auth timer); they are issued without the default policy.
path "auth/token/lookup-self" {
  capabilities = ["read"]
}

path "auth/token/renew-self" {
  capabilities = ["update"]
}
