# Separate documents avoid rewriting the shared personal KV documents when a
# connector is created or its token changes. Paths are declared in inventory.
resource "vault_kv_secret_v2" "local_tunnel" {
  for_each = {
    for name, tunnel in local.config.cloudflare.additional_tunnels : name => tunnel
    if try(tunnel.credential_path, null) != null
  }
  mount     = vault_mount.secret.path
  name      = each.value.credential_path
  data_json = jsonencode({ TUNNEL_TOKEN = data.terraform_remote_state.foundation.outputs.local_tunnel_tokens[each.key] })
  lifecycle { prevent_destroy = true }
}
