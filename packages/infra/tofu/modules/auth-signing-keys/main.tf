terraform {
  required_providers {
    keycloak = { source = "keycloak/keycloak", version = "= 5.9.0" }
    tls      = { source = "hashicorp/tls", version = "= 4.1.0" }
  }
}
variable "realm_id" { type = string }
variable "generations" {
  type = map(object({ priority = number, active = bool }))
  validation {
    condition     = length(var.generations) > 0 && anytrue([for key in values(var.generations) : key.active]) && length(distinct([for key in values(var.generations) : key.priority])) == length(var.generations) && alltrue([for key in values(var.generations) : key.priority > 100])
    error_message = "Keep at least one active signing key, with unique priorities above the built-in provider."
  }
}
# Named generations are additive. Add a higher priority generation, verify
# overlapping JWKS, and only retire the old generation after the documented
# token/cache window. Private material never enters container files or outputs.
resource "tls_private_key" "this" {
  for_each  = var.generations
  algorithm = "RSA"
  rsa_bits  = 3072
}
resource "tls_self_signed_cert" "this" {
  for_each              = var.generations
  private_key_pem       = tls_private_key.this[each.key].private_key_pem
  validity_period_hours = 87600
  allowed_uses          = ["digital_signature"]
  subject { common_name = "${var.realm_id}-${each.key}" }
}
resource "keycloak_realm_keystore_rsa" "this" {
  for_each    = var.generations
  realm_id    = var.realm_id
  name        = "managed-${each.key}"
  provider_id = "rsa"
  algorithm   = "RS256"
  enabled     = true
  active      = each.value.active
  priority    = each.value.priority
  private_key = tls_private_key.this[each.key].private_key_pem_pkcs8
  certificate = tls_self_signed_cert.this[each.key].cert_pem
}
