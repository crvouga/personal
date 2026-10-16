# Keep Atlas confined to Pickflix in the shared database. See fleet-database.tf.
resource "postgresql_schema" "pickflix" {
  name          = "pickflix"
  if_not_exists = true
  lifecycle { prevent_destroy = true }
}

resource "atlas_schema" "pickflix" {
  url        = "${local.database_url}&search_path=pickflix"
  dev_url    = var.schema_dev_url
  hcl        = file("${path.module}/pickflix-schema.hcl")
  depends_on = [postgresql_schema.pickflix]
  lifecycle { prevent_destroy = true }
}
