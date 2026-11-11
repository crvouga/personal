# Direct-connection roles with the REPLICATION attribute for logical
# replication consumers (CDC, sync engines). PlanetScale grants REPLICATION
# only to roles that inherit `postgres`. Each URL is published to Vault under
# the role's `vault_key`; the consumer owns its publications and slots.
resource "planetscale_postgres_branch_role" "replication" {
  for_each         = { for role in try(local.postgres.replication_roles, []) : role.name => role }
  organization     = local.postgres.organization
  database         = local.postgres.name
  branch           = planetscale_postgres_branch.openbao.name
  name             = each.key
  inherited_roles  = ["postgres"]
  with_replication = true
  lifecycle { prevent_destroy = true }
}

output "replication_database_urls" {
  sensitive = true
  value = {
    for name, role in planetscale_postgres_branch_role.replication :
    local.postgres.replication_roles[index(local.postgres.replication_roles[*].name, name)].vault_key =>
    "postgres://${urlencode(role.username)}:${urlencode(role.password)}@${role.access_host_url}/${role.database_name}?sslmode=require"
  }
}
