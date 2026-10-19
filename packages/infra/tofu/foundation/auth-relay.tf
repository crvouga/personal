# Opt-in until live acceptance is complete. Existing shared Postgres only;
# separate schema/role per broker, never a dedicated database or owner password.
locals {
  auth_instances = local.config.auth_relay.enabled ? local.config.auth_relay.instances : {}
  # PlanetScale usernames carry a ".<branch id>" routing suffix that exists only
  # on the wire; the Postgres role itself is the part before the dot. The
  # PostgreSQL provider looks roles up in pg_roles, so it needs the bare name.
  auth_relay_role   = { for key, role in planetscale_postgres_branch_role.auth_relay : key => split(".", role.username)[0] }
  auth_console_role = { for key, role in planetscale_postgres_branch_role.auth_console : key => split(".", role.username)[0] }
  openbao_role      = split(".", planetscale_postgres_branch_role.openbao.username)[0]
}
resource "planetscale_postgres_branch_role" "auth_relay" {
  for_each        = local.auth_instances
  organization    = local.postgres.organization
  database        = local.postgres.name
  branch          = planetscale_postgres_branch.openbao.name
  name            = "auth-${each.key}"
  inherited_roles = []
  lifecycle { prevent_destroy = true }
}
resource "postgresql_schema" "auth_relay" {
  for_each = local.auth_instances
  name     = each.value.database_schema
  lifecycle { prevent_destroy = true }
}
# Not the schema owner: PlanetScale refuses the GRANT <role> TO <owner> the
# provider needs to assign ownership to an API-created role. The connection
# role owns the schema; Keycloak gets what it needs to create its own tables.
resource "postgresql_grant" "auth_relay_schema" {
  for_each    = local.auth_instances
  database    = planetscale_postgres_branch_role.openbao.database_name
  role        = local.auth_relay_role[each.key]
  schema      = postgresql_schema.auth_relay[each.key].name
  object_type = "schema"
  privileges  = ["USAGE", "CREATE"]
}
output "auth_relay_database" {
  sensitive = true
  value = { for key, role in planetscale_postgres_branch_role.auth_relay : key => {
    KC_DB_URL      = "jdbc:postgresql://${role.access_host_url}/${role.database_name}?sslmode=verify-full"
    KC_DB_USERNAME = role.username
    KC_DB_PASSWORD = role.password
    KC_DB_SCHEMA   = local.auth_instances[key].database_schema
  } }
}

# UI registrations are runtime data. Atlas owns only this application's
# isolated schema; Keycloak's own tables remain in its separate schema above.
resource "planetscale_postgres_branch_role" "auth_console" {
  for_each        = local.auth_instances
  organization    = local.postgres.organization
  database        = local.postgres.name
  branch          = planetscale_postgres_branch.openbao.name
  name            = "auth-console-${each.key}"
  inherited_roles = []
  lifecycle { prevent_destroy = true }
}
resource "postgresql_schema" "auth_console" {
  for_each = local.auth_instances
  name     = "auth_relay_${each.key}"
  lifecycle { prevent_destroy = true }
}
resource "atlas_schema" "auth_console" {
  for_each   = local.auth_instances
  url        = "${local.database_url}&search_path=auth_relay_${each.key}"
  dev_url    = var.schema_dev_url
  hcl        = templatefile("${path.module}/../../../auth-relay/schema.hcl", { schema = "auth_relay_${each.key}" })
  depends_on = [postgresql_schema.auth_console]
  lifecycle { prevent_destroy = true }
}
resource "postgresql_grant" "auth_console_schema" {
  for_each    = local.auth_instances
  database    = planetscale_postgres_branch_role.openbao.database_name
  role        = local.auth_console_role[each.key]
  schema      = postgresql_schema.auth_console[each.key].name
  object_type = "schema"
  privileges  = ["USAGE"]
}
resource "postgresql_grant" "auth_console_tables" {
  for_each    = local.auth_instances
  database    = planetscale_postgres_branch_role.openbao.database_name
  role        = local.auth_console_role[each.key]
  schema      = postgresql_schema.auth_console[each.key].name
  object_type = "table"
  privileges  = ["SELECT", "INSERT", "UPDATE", "DELETE"]
  depends_on  = [atlas_schema.auth_console]
}
resource "postgresql_grant" "auth_console_sequences" {
  for_each    = local.auth_instances
  database    = planetscale_postgres_branch_role.openbao.database_name
  role        = local.auth_console_role[each.key]
  schema      = postgresql_schema.auth_console[each.key].name
  object_type = "sequence"
  privileges  = ["USAGE", "SELECT"]
  depends_on  = [atlas_schema.auth_console]
}
resource "postgresql_default_privileges" "auth_console_tables" {
  for_each    = local.auth_instances
  database    = planetscale_postgres_branch_role.openbao.database_name
  owner       = local.openbao_role
  role        = local.auth_console_role[each.key]
  schema      = postgresql_schema.auth_console[each.key].name
  object_type = "table"
  privileges  = ["SELECT", "INSERT", "UPDATE", "DELETE"]
}
resource "postgresql_default_privileges" "auth_console_sequences" {
  for_each    = local.auth_instances
  database    = planetscale_postgres_branch_role.openbao.database_name
  owner       = local.openbao_role
  role        = local.auth_console_role[each.key]
  schema      = postgresql_schema.auth_console[each.key].name
  object_type = "sequence"
  privileges  = ["USAGE", "SELECT"]
}
output "auth_console_database" {
  sensitive = true
  value = { for key, role in planetscale_postgres_branch_role.auth_console : key =>
    "postgres://${urlencode(role.username)}:${urlencode(role.password)}@${role.access_host_url}/${role.database_name}?sslmode=verify-full"
  }
}

# Keycloak's admin API stays off the public gateway. CI reaches it only through
# a Cloudflare Tunnel whose hostname is an Access application that admits a
# single service token. The connector runs inside the private Railway project
# (auth-hosting) and the identity service gets no public ingress.
resource "random_password" "auth_admin_tunnel" {
  for_each = local.auth_instances
  length   = 64
  special  = false
}
resource "random_password" "auth_admin_password" {
  for_each = local.auth_instances
  length   = 48
  special  = false
}
resource "cloudflare_zero_trust_tunnel_cloudflared" "auth_admin" {
  for_each      = local.auth_instances
  account_id    = var.cloudflare_account_id
  name          = "auth-admin-${each.key}"
  tunnel_secret = base64encode(random_password.auth_admin_tunnel[each.key].result)
  lifecycle { prevent_destroy = true }
}
resource "cloudflare_zero_trust_tunnel_cloudflared_config" "auth_admin" {
  for_each   = local.auth_instances
  account_id = var.cloudflare_account_id
  tunnel_id  = cloudflare_zero_trust_tunnel_cloudflared.auth_admin[each.key].id
  config = {
    ingress = [
      { hostname = each.value.admin_hostname, service = "http://${each.value.service.id}-identity.railway.internal:8080" },
      { service = "http_status:404" }
    ]
  }
}
data "cloudflare_zero_trust_tunnel_cloudflared_token" "auth_admin" {
  for_each   = local.auth_instances
  account_id = var.cloudflare_account_id
  tunnel_id  = cloudflare_zero_trust_tunnel_cloudflared.auth_admin[each.key].id
}
resource "cloudflare_dns_record" "auth_admin" {
  for_each = local.auth_instances
  zone_id  = cloudflare_zone.primary.id
  name     = each.value.admin_hostname
  type     = "CNAME"
  content  = "${cloudflare_zero_trust_tunnel_cloudflared.auth_admin[each.key].id}.cfargotunnel.com"
  ttl      = 1
  proxied  = true
  lifecycle { prevent_destroy = true }
}
resource "cloudflare_zero_trust_access_service_token" "auth_admin" {
  for_each   = local.auth_instances
  account_id = var.cloudflare_account_id
  name       = "auth-admin-${each.key}-ci"
  duration   = "8760h"
}
resource "cloudflare_zero_trust_access_policy" "auth_admin" {
  for_each   = local.auth_instances
  account_id = var.cloudflare_account_id
  name       = "auth-admin-${each.key}-ci"
  decision   = "non_identity"
  include    = [{ service_token = { token_id = cloudflare_zero_trust_access_service_token.auth_admin[each.key].id } }]
}
resource "cloudflare_zero_trust_access_application" "auth_admin" {
  for_each         = local.auth_instances
  account_id       = var.cloudflare_account_id
  name             = "auth-admin-${each.key}"
  type             = "self_hosted"
  domain           = each.value.admin_hostname
  session_duration = "1h"
  policies         = [{ id = cloudflare_zero_trust_access_policy.auth_admin[each.key].id, precedence = 1 }]
}
output "auth_admin" {
  sensitive = true
  value = { for key, instance in local.auth_instances : key => {
    url                  = "https://${instance.admin_hostname}"
    username             = "admin"
    password             = random_password.auth_admin_password[key].result
    tunnel_token         = data.cloudflare_zero_trust_tunnel_cloudflared_token.auth_admin[key].token
    access_client_id     = cloudflare_zero_trust_access_service_token.auth_admin[key].client_id
    access_client_secret = cloudflare_zero_trust_access_service_token.auth_admin[key].client_secret
  } }
}
