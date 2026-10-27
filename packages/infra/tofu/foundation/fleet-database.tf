# The fleet API (packages/fleet-api) keeps its data in the Postgres schema
# "fleet" of the shared PlanetScale database that also holds other projects'
# schemas. The split of ownership is deliberate:
#
#   postgresql_schema.fleet  runs the single CREATE SCHEMA. Atlas refuses to
#                            work on a schema that does not exist yet.
#   atlas_schema.fleet       owns everything inside the schema: tables,
#                            columns, indexes and constraints (schema.hcl).
#
# Atlas must never see the whole database. Without search_path it diffs every
# schema against its HCL and plans to drop the ones it does not know (public,
# secret_store, other projects). exclude globs do not prevent that and include
# needs Atlas Pro, so the url below is scoped to "fleet" and nothing else.
# Never use atlas_migration here: without dev_url it cleans the target
# database, and with dev_url it runs `atlas migrate lint`, which needs Atlas Pro.
#
# The PostgreSQL provider (providers.tf) connects with the same role, host and
# database that local.database_url is assembled from (main.tf).
resource "postgresql_schema" "fleet" {
  name          = "fleet"
  if_not_exists = true
  lifecycle { prevent_destroy = true }
}

resource "atlas_schema" "fleet" {
  url        = "${local.database_url}&search_path=fleet"
  dev_url    = var.schema_dev_url
  hcl        = file("${path.module}/../../../../vendor/fleet/packages/fleet-api/schema.hcl")
  depends_on = [postgresql_schema.fleet]
  lifecycle { prevent_destroy = true }
}
