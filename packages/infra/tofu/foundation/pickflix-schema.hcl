# Owned here; Pickflix production performs no DDL.
schema "pickflix" {}

table "auto_lists" {
  schema = schema.pickflix
  column "id" {
    type = text
    null = true
  }
  column "auto_list_key" {
    type = text
    null = true
  }
  column "owner_id" {
    type = text
    null = true
  }
}

table "list_items" {
  schema = schema.pickflix
  column "id" {
    type = text
    null = true
  }
  column "user_id" {
    type = text
    null = true
  }
  column "list_id" {
    type = text
    null = true
  }
  column "created_at" {
    type = bigint
    null = true
  }
  column "media_id" {
    type = text
    null = true
  }
}

table "lists" {
  schema = schema.pickflix
  column "id" {
    type = text
    null = true
  }
  column "title" {
    type = text
    null = true
  }
  column "description" {
    type = text
    null = true
  }
  column "created_at" {
    type = bigint
    null = true
  }
  column "updated_at" {
    type = bigint
    null = true
  }
  column "owner_id" {
    type = text
    null = true
  }
}

table "permissions" {
  schema = schema.pickflix
  column "permission_type" {
    type = text
    null = true
  }
  column "id" {
    type = text
    null = true
  }
  column "user_id" {
    type = text
    null = true
  }
  column "list_id" {
    type = text
    null = true
  }
  column "created_at" {
    type = bigint
    null = true
  }
}

table "tmdb_discover_tags" {
  schema = schema.pickflix
  column "id" {
    type = text
    null = true
  }
  column "tags_by_id" {
    type = text
    null = true
  }
  column "key" {
    type = text
    null = true
  }
  column "user_id" {
    type = text
    null = true
  }
  column "created_at" {
    type = bigint
    null = true
  }
}

table "reviews" {
  schema = schema.pickflix
  column "id" {
    type = text
    null = true
  }
  column "author_id" {
    type = text
    null = true
  }
  column "content" {
    type = text
    null = true
  }
  column "rating" {
    type = bigint
    null = true
  }
  column "media_id" {
    type = text
    null = true
  }
  column "created_at" {
    type = bigint
    null = true
  }
  column "updated_at" {
    type = bigint
    null = true
  }
}

table "review_votes" {
  schema = schema.pickflix
  column "id" {
    type = text
    null = true
  }
  column "user_id" {
    type = text
    null = true
  }
  column "review_id" {
    type = text
    null = true
  }
  column "vote_value" {
    type = text
    null = true
  }
}

table "credentials" {
  schema = schema.pickflix
  column "id" {
    type = text
    null = true
  }
  column "user_id" {
    type = text
    null = true
  }
  column "credential_type" {
    type = text
    null = true
  }
  column "password_hash" {
    type = text
    null = true
  }
  column "verified_at" {
    type = bigint
    null = true
  }
}

table "users" {
  schema = schema.pickflix
  column "id" {
    type = text
    null = true
  }
  column "username" {
    type = text
    null = true
  }
  column "email_address" {
    type = text
    null = true
  }
  column "display_name" {
    type = text
    null = true
  }
}

table "session" {
  schema = schema.pickflix
  column "sid" {
    type = varchar(255)
    null = false
  }
  column "sess" {
    type = json
    null = false
  }
  column "expire" {
    type = timestamp(6)
    null = false
  }
  primary_key {
    columns = [column.sid]
  }
  index "IDX_session_expire" {
    columns = [column.expire]
  }
}
