# Atlas is the schema provider. The schema is part of OpenTofu desired state;
# no migration runner or SQL provisioning scripts remain.
resource "atlas_schema" "openbao" {
  url     = "${local.database_url}&search_path=secret_store"
  dev_url = var.schema_dev_url
  hcl     = <<-SCHEMA
    table "schema_migrations" {
      schema = schema.secret_store
      column "version" {
        null = false
        type = text
      }
      column "applied_at" {
        null    = false
        type    = timestamptz
        default = sql("now()")
      }
      primary_key {
        columns = [column.version]
      }
    }
    table "vault_ha_locks" {
      schema = schema.secret_store
      column "ha_key" {
        null    = false
        type    = text
        collate = "C"
      }
      column "ha_identity" {
        null    = false
        type    = text
        collate = "C"
      }
      column "ha_value" {
        null    = true
        type    = text
        collate = "C"
      }
      column "valid_until" {
        null = false
        type = timestamptz
      }
      primary_key {
        columns = [column.ha_key]
      }
    }
    table "vault_kv_store" {
      schema = schema.secret_store
      column "parent_path" {
        null    = false
        type    = text
        collate = "C"
      }
      column "path" {
        null    = false
        type    = text
        collate = "C"
      }
      column "key" {
        null    = false
        type    = text
        collate = "C"
      }
      column "value" {
        null = true
        type = bytea
      }
      primary_key {
        columns = [column.path, column.key]
      }
      index "vault_kv_store_idx" {
        columns = [column.parent_path]
      }
    }
    schema "secret_store" {
    }
  SCHEMA
  lifecycle { prevent_destroy = true }
}
