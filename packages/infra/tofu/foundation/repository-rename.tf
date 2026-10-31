# GitHub renamed the existing repository; none of its data is being recreated.
# These three provider schemas ForceNew on repository slug. Forget old bindings
# and import the same live objects at new addresses instead of deleting them.
removed {
  from = github_issue_labels.workspace
  lifecycle { destroy = false }
}
removed {
  from = github_repository_vulnerability_alerts.workspace
  lifecycle { destroy = false }
}
removed {
  from = github_repository_dependabot_security_updates.workspace
  lifecycle { destroy = false }
}

# The dispatch credential is the same secret on the same repository ID.
moved {
  from = github_actions_secret.dispatch["workspace"]
  to   = github_actions_secret.dispatch["personal"]
}
