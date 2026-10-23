removed {
  from = github_actions_secret.retired
  lifecycle { destroy = true }
}

removed {
  from = github_repository_file.retired_publisher
  lifecycle { destroy = true }
}

# PlanetScale replaced Neon. Forget the project instead of deleting it so the
# previous OpenBao storage survives the cutover.
removed {
  from = neon_project.openbao
  lifecycle { destroy = false }
}

# Pickflix owns its schema and publisher. Forget ownership without touching
# the live schema, tables, data, or workflow file.
removed {
  from = atlas_schema.pickflix
  lifecycle { destroy = false }
}
removed {
  from = postgresql_schema.pickflix
  lifecycle { destroy = false }
}
moved {
  from = github_repository_file.publish["pickflix-v1"]
  to   = github_repository_file.application_owned_publisher
}
removed {
  from = github_repository_file.application_owned_publisher
  lifecycle { destroy = false }
}

# Protected application repositories own publisher changes through their PRs.
# Forget the old platform resource without deleting or rewriting the live file.
moved {
  from = github_repository_file.publish["mockingbird"]
  to   = github_repository_file.application_owned_publishers["mockingbird"]
}
removed {
  from = github_repository_file.application_owned_publishers
  lifecycle { destroy = false }
}
