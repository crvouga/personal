# Services adopts this same DNS record ID as the additional Railway domain's CNAME.
# Forget ownership here without deleting the live record before services imports it.
moved {
  from = cloudflare_dns_record.domain["moviefinder.app:aaaa-af6bfaa788cbc384"]
  to   = cloudflare_dns_record.service_alias_handoff
}

removed {
  from = cloudflare_dns_record.service_alias_handoff
  lifecycle { destroy = false }
}
