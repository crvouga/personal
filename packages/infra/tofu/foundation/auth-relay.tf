# Opt-in until live acceptance is complete. Existing shared Postgres only;
# separate schema/role per broker, never a dedicated database or owner password.
locals {
  auth_instances = local.config.auth_relay.enabled ? local.config.auth_relay.instances : {}
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
  owner    = planetscale_postgres_branch_role.auth_relay[each.key].username
  lifecycle { prevent_destroy = true }
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
  role        = planetscale_postgres_branch_role.auth_console[each.key].username
  schema      = postgresql_schema.auth_console[each.key].name
  object_type = "schema"
  privileges  = ["USAGE"]
}
resource "postgresql_grant" "auth_console_tables" {
  for_each    = local.auth_instances
  database    = planetscale_postgres_branch_role.openbao.database_name
  role        = planetscale_postgres_branch_role.auth_console[each.key].username
  schema      = postgresql_schema.auth_console[each.key].name
  object_type = "table"
  privileges  = ["SELECT", "INSERT", "UPDATE", "DELETE"]
  depends_on  = [atlas_schema.auth_console]
}
resource "postgresql_grant" "auth_console_sequences" {
  for_each    = local.auth_instances
  database    = planetscale_postgres_branch_role.openbao.database_name
  role        = planetscale_postgres_branch_role.auth_console[each.key].username
  schema      = postgresql_schema.auth_console[each.key].name
  object_type = "sequence"
  privileges  = ["USAGE", "SELECT"]
  depends_on  = [atlas_schema.auth_console]
}
resource "postgresql_default_privileges" "auth_console_tables" {
  for_each    = local.auth_instances
  database    = planetscale_postgres_branch_role.openbao.database_name
  owner       = planetscale_postgres_branch_role.openbao.username
  role        = planetscale_postgres_branch_role.auth_console[each.key].username
  schema      = postgresql_schema.auth_console[each.key].name
  object_type = "table"
  privileges  = ["SELECT", "INSERT", "UPDATE", "DELETE"]
}
resource "postgresql_default_privileges" "auth_console_sequences" {
  for_each    = local.auth_instances
  database    = planetscale_postgres_branch_role.openbao.database_name
  owner       = planetscale_postgres_branch_role.openbao.username
  role        = planetscale_postgres_branch_role.auth_console[each.key].username
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
