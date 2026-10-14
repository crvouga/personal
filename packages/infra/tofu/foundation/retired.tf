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
