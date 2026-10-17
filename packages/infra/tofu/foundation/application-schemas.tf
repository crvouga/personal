# Opt-in namespace allocation only. Application repositories own all table DDL
# and Atlas migration history inside their allocated namespaces.
# Existing externally-owned schemas are never adopted implicitly.
resource "postgresql_schema" "application" {
  for_each = {
    for service in local.config.services : service.id => service.database_schema
    if try(service.manage_database_schema, false)
  }
  name          = each.value
  if_not_exists = true
  lifecycle { prevent_destroy = true }
}
