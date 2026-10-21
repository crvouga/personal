# OpenBao server configuration for Docker deployment.
# Connection URL is provided via BAO_PG_CONNECTION_URL (set from DB_CONNECTION_URI by entrypoint).
# API address is provided via BAO_API_ADDR (set by OpenTofu Railway variables).

storage "postgresql" {
  table             = "vault_kv_store"
  ha_table          = "vault_ha_locks"
  skip_create_table = true
  # The backend allows 128 parallel requests, each on its own connection. The
  # shared PostgreSQL cluster has about 25 slots, so a burst of secret reads
  # (every CI job loads Vault) starves deploy planning (53300). Bound the pool.
  max_parallel         = "4"
  max_idle_connections = 2
}

listener "tcp" {
  address     = "127.0.0.1:8201"
  tls_disable = true
}

ui             = true
disable_mlock  = true
log_format     = "json"
