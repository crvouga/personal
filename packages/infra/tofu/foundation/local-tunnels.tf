# Optional DNS and isolated credential delivery for remotely managed connectors.
# Cloud resources stay here; workstation startup only reads Vault and runs them.
locals {
  local_tunnels = {
    for name, tunnel in local.config.cloudflare.additional_tunnels : name => tunnel
    if try(tunnel.credential_path, null) != null
  }
}

resource "cloudflare_dns_record" "local_tunnel" {
  for_each = local.local_tunnels
  zone_id  = cloudflare_zone.primary.id
  name     = each.value.hostname
  type     = "CNAME"
  content  = "${cloudflare_zero_trust_tunnel_cloudflared.additional[each.key].id}.cfargotunnel.com"
  ttl      = 1
  proxied  = true
  lifecycle { prevent_destroy = true }
}

data "cloudflare_zero_trust_tunnel_cloudflared_token" "local" {
  for_each   = local.local_tunnels
  account_id = var.cloudflare_account_id
  tunnel_id  = cloudflare_zero_trust_tunnel_cloudflared.additional[each.key].id
}

output "local_tunnel_tokens" {
  sensitive = true
  value     = { for name, credential in data.cloudflare_zero_trust_tunnel_cloudflared_token.local : name => credential.token }
}
