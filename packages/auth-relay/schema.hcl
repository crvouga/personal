# Applied only through the foundation Atlas provider, scoped to this schema.
schema "${schema}" {}

table "bootstrap" {
  schema = schema.${schema}
  column "id" {
    type = integer
    null = false
  }
  primary_key { columns = [column.id] }
}

table "operators" {
  schema = schema.${schema}
  column "subject" {
    type = text
    null = false
  }
  primary_key { columns = [column.subject] }
}

table "logins" {
  schema = schema.${schema}
  column "state" {
    type = text
    null = false
  }
  column "verifier" {
    type = text
    null = false
  }
  column "nonce" {
    type = text
    null = false
  }
  column "binding" {
    type = text
    null = false
  }
  column "expires_at" {
    type = timestamptz
    null = false
  }
  primary_key { columns = [column.state] }
}

table "sessions" {
  schema = schema.${schema}
  column "token_hash" {
    type = text
    null = false
  }
  column "subject" {
    type = text
    null = false
  }
  column "csrf" {
    type = text
    null = false
  }
  column "expires_at" {
    type = timestamptz
    null = false
  }
  primary_key { columns = [column.token_hash] }
}

table "clients" {
  schema = schema.${schema}
  column "agent_id" {
    type = text
    null = true
  }
  column "id" {
    type = text
    null = false
  }
  column "remote_clean" {
    type = boolean
    null = false
    default = false
  }
  column "desired" {
    type = jsonb
    null = true
  }
  column "revision" {
    type = integer
    null = false
    default = 0
  }
  column "project" {
    type = text
    null = false
  }
  column "environment" {
    type = text
    null = false
  }
  column "instance" {
    type = text
    null = false
  }
  column "config" {
    type = jsonb
    null = true
  }
  column "previous" {
    type = jsonb
    null = false
    default = sql("'[]'::jsonb")
  }
  column "overlap_until" {
    type = timestamptz
    null = true
  }
  column "expires_at" {
    type = timestamptz
    null = true
  }
  column "revoked" {
    type = boolean
    null = false
    default = false
  }
  primary_key { columns = [column.id] }
  index "client_identity" {
    unique = true
    columns = [column.project, column.environment, column.instance]
  }
}

table "agent_grants" {
  schema = schema.${schema}
  column "id" {
    type = text
    null = false
  }
  column "token_hash" {
    type = text
    null = false
  }
  column "config" {
    type = jsonb
    null = false
  }
  column "expires_at" {
    type = timestamptz
    null = false
  }
  column "revoked" {
    type = boolean
    null = false
    default = false
  }
  column "revision" {
    type = integer
    null = false
    default = 0
  }
  primary_key { columns = [column.id] }
  index "agent_token_hash" {
    unique = true
    columns = [column.token_hash]
  }
}

table "audit" {
  schema = schema.${schema}
  column "id" {
    type = bigserial
    null = false
  }
  column "subject" {
    type = text
    null = false
  }
  column "action" {
    type = text
    null = false
  }
  column "client_id" {
    type = text
    null = false
  }
  column "created_at" {
    type = timestamptz
    null = false
    default = sql("now()")
  }
  primary_key { columns = [column.id] }
}

table "limits" {
  schema = schema.${schema}
  column "key" {
    type = text
    null = false
  }
  column "window" {
    type = bigint
    null = false
  }
  column "count" {
    type = integer
    null = false
  }
  primary_key { columns = [column.key] }
}
