locals {
  merge_gate = local.config.github.pr_ready
  pr_rule    = one([for rule in local.merge_gate.ruleset.rules : rule.parameters if rule.type == "pull_request"])
  check_rule = one([for rule in local.merge_gate.ruleset.rules : rule.parameters if rule.type == "required_status_checks"])
  application_repository_defaults = {
    visibility                  = "public"
    archived                    = false
    has_issues                  = true
    has_projects                = true
    has_wiki                    = true
    has_discussions             = false
    is_template                 = false
    web_commit_signoff_required = false
    allow_forking               = true
    allow_merge_commit          = true
    allow_squash_merge          = true
    allow_rebase_merge          = true
    allow_auto_merge            = false
    allow_update_branch         = false
    delete_branch_on_merge      = false
    merge_commit_title          = "MERGE_MESSAGE"
    merge_commit_message        = "PR_TITLE"
    squash_merge_commit_title   = "COMMIT_OR_PR_TITLE"
    squash_merge_commit_message = "COMMIT_MESSAGES"
    workflow_permissions        = "read"
  }
  application_repositories = {
    for name, settings in local.config.github.repositories : name => merge(local.application_repository_defaults, settings)
  }
  standard_labels = local.merge_gate.labels
  dependency_label = {
    name        = "dependencies"
    color       = "0366d6"
    description = "Pull requests that update a dependency file"
  }
  accessibility_label = {
    name        = "accessibility"
    color       = "f143ab"
    description = "Barrier affecting people with disabilities"
  }
  mockingbird_labels = [
    local.accessibility_label,
    { name = "agent-reported", color = "5319e7", description = "Filed through docs/REPORTING_ISSUES.md; the /resolve-issues queue" },
    { name = "bug", color = "d73a4a", description = "A mock crashes, leaks state, contradicts its README, or does not build" },
    { name = "documentation", color = "0075ca", description = "Improvements or additions to documentation" },
    { name = "duplicate", color = "cfd3d7", description = "This issue or pull request already exists" },
    { name = "enhancement", color = "a2eeef", description = "New feature or request" },
    { name = "feature", color = "0e8a16", description = "An existing mock lacks an operation, parameter, event or behavior" },
    { name = "good first issue", color = "7057ff", description = "Good for newcomers" },
    { name = "help wanted", color = "008672", description = "Extra attention is needed" },
    { name = "invalid", color = "e4e669", description = "This doesn't seem right" },
    { name = "needs-info", color = "fbca04", description = "Waiting on the reporter for a version, reproduction or behavior" },
    { name = "needs-oracle-check", color = "c5def5", description = "The claim could not be confirmed against the oracle yet" },
    { name = "new-service", color = "1d76db", description = "Request for a vendor API the catalog does not mock yet" },
    { name = "parity", color = "d93f0b", description = "The mock and its oracle answer the same requests differently" },
    { name = "question", color = "d876e3", description = "Further information is requested" },
    { name = "wontfix", color = "ffffff", description = "This will not be worked on" },
  ]
  application_labels = {
    for name in keys(local.application_repositories) : name => (
      name == "mockingbird" ? local.mockingbird_labels : concat(
        local.standard_labels,
        contains(["connect-four", "match-three", "simon-says"], name) ? [local.dependency_label] : [],
        name == "violets-garden" ? [local.accessibility_label] : [],
      )
    )
  }
  application_environments = merge([
    for repository, settings in local.application_repositories : {
      for environment in settings.environments : "${repository}:${environment}" => {
        repository  = repository
        environment = environment
      }
    }
  ]...)
  repository_secret_sources = merge([
    for repository, settings in local.application_repositories : {
      for name in try(settings.actions_secrets, []) : "${repository}:${name}" => {
        repository = repository
        name       = name
      }
    }
  ]...)
}

data "github_actions_secrets" "repository" {
  for_each = toset([for secret in values(local.repository_secret_sources) : secret.repository])
  name     = each.key
}

locals {
  existing_repository_secrets = {
    for key, secret in local.repository_secret_sources : key => secret
    if contains([for existing in data.github_actions_secrets.repository[secret.repository].secrets : existing.name], secret.name)
  }
  unavailable_repository_secrets = setsubtract(toset(keys(local.repository_secret_sources)), toset(keys(local.existing_repository_secrets)))
}

output "unavailable_repository_secrets" {
  description = "Missing GitHub secret names; only their dependent integrations should be skipped."
  value       = local.unavailable_repository_secrets
}

resource "github_repository" "application" {
  for_each                    = local.application_repositories
  name                        = each.key
  description                 = each.value.description
  homepage_url                = each.value.homepage
  visibility                  = each.value.visibility
  archived                    = each.value.archived
  topics                      = each.value.topics
  has_issues                  = each.value.has_issues
  has_projects                = each.value.has_projects
  has_wiki                    = each.value.has_wiki
  has_discussions             = each.value.has_discussions
  is_template                 = each.value.is_template
  web_commit_signoff_required = each.value.web_commit_signoff_required
  allow_forking               = each.value.allow_forking
  merge_commit_title          = each.value.merge_commit_title
  merge_commit_message        = each.value.merge_commit_message
  squash_merge_commit_title   = each.value.squash_merge_commit_title
  squash_merge_commit_message = each.value.squash_merge_commit_message
  allow_merge_commit          = each.value.allow_merge_commit
  allow_squash_merge          = each.value.allow_squash_merge
  allow_rebase_merge          = each.value.allow_rebase_merge
  allow_auto_merge            = each.value.allow_auto_merge
  allow_update_branch         = each.value.allow_update_branch
  delete_branch_on_merge      = each.value.delete_branch_on_merge
  security_and_analysis {
    secret_scanning { status = each.value.secret_scanning }
    secret_scanning_push_protection { status = each.value.secret_scanning_push_protection }
    secret_scanning_non_provider_patterns { status = "disabled" }
  }
  lifecycle {
    prevent_destroy = true
    ignore_changes  = [pages]
  }
}

# The separate Pages resource owns site configuration. Ignore the deprecated
# repository block so adoption cannot disable the existing site.
resource "github_repository_pages" "application" {
  for_each   = { for name, settings in local.application_repositories : name => settings if try(settings.pages, null) != null }
  repository = github_repository.application[each.key].name
  build_type = each.value.pages.build_type
  source {
    branch = each.value.pages.branch
    path   = each.value.pages.path
  }
}

resource "github_branch_default" "application" {
  for_each   = local.application_repositories
  repository = github_repository.application[each.key].name
  branch     = each.value.default_branch
}

resource "github_actions_repository_permissions" "application" {
  for_each             = local.application_repositories
  repository           = github_repository.application[each.key].name
  enabled              = true
  allowed_actions      = "all"
  sha_pinning_required = false
}

resource "github_workflow_repository_permissions" "application" {
  for_each                         = local.application_repositories
  repository                       = github_repository.application[each.key].name
  default_workflow_permissions     = each.value.workflow_permissions
  can_approve_pull_request_reviews = each.value.workflow_permissions == "write"
}

resource "github_repository_vulnerability_alerts" "application" {
  for_each   = local.application_repositories
  repository = github_repository.application[each.key].name
  enabled    = each.value.vulnerability_alerts
}

resource "github_repository_dependabot_security_updates" "application" {
  for_each   = local.application_repositories
  repository = github_repository.application[each.key].name
  enabled    = each.value.dependabot_security_updates
  depends_on = [github_repository_vulnerability_alerts.application]
}

resource "github_repository_collaborators" "application" {
  for_each   = local.application_repositories
  repository = github_repository.application[each.key].name
  dynamic "user" {
    for_each = merge(
      { crvouga = "admin" },
      each.key == "mockingbird" ? { crsiebler = "push", freddie-geviti = "push" } : {},
    )
    content {
      username   = user.key
      permission = user.value
    }
  }
}

resource "github_issue_labels" "application" {
  for_each   = local.application_labels
  repository = github_repository.application[each.key].name
  dynamic "label" {
    for_each = { for label in each.value : label.name => label }
    content {
      name        = label.value.name
      color       = label.value.color
      description = label.value.description
    }
  }
}

resource "github_repository_environment" "application" {
  for_each    = local.application_environments
  repository  = github_repository.application[each.value.repository].name
  environment = each.value.environment
  lifecycle { prevent_destroy = true }
}

resource "github_repository_ruleset" "mockingbird_main" {
  repository  = github_repository.application["mockingbird"].name
  name        = "Protect main"
  target      = "branch"
  enforcement = "active"
  conditions {
    ref_name {
      include = ["refs/heads/main"]
      exclude = []
    }
  }
  rules {
    deletion         = true
    non_fast_forward = true
    pull_request {
      allowed_merge_methods             = ["merge"]
      dismiss_stale_reviews_on_push     = false
      require_code_owner_review         = false
      require_last_push_approval        = false
      required_approving_review_count   = 0
      required_review_thread_resolution = false
    }
    required_status_checks {
      strict_required_status_checks_policy = true
      required_check {
        context        = "Commitlint"
        integration_id = 15368
      }
      required_check {
        context        = "Check"
        integration_id = 15368
      }
      required_check {
        context        = "GitGuardian Security Checks"
        integration_id = 46505
      }
    }
  }
}

resource "github_actions_secret" "repository" {
  for_each    = local.existing_repository_secrets
  repository  = each.value.repository
  secret_name = each.value.name
  # GitHub cannot return secret values. This empty value is ignored after
  # import; the import block and metadata listing adopt existing secrets.
  value = ""
  lifecycle {
    prevent_destroy = true
    ignore_changes  = [value]
  }
}

import {
  for_each = local.application_repositories
  to       = github_repository.application[each.key]
  id       = each.key
}
import {
  for_each = local.application_repositories
  to       = github_branch_default.application[each.key]
  id       = each.key
}
import {
  for_each = local.application_repositories
  to       = github_actions_repository_permissions.application[each.key]
  id       = each.key
}
import {
  for_each = local.application_repositories
  to       = github_workflow_repository_permissions.application[each.key]
  id       = each.key
}
import {
  for_each = { for name, settings in local.application_repositories : name => settings if settings.vulnerability_alerts }
  to       = github_repository_vulnerability_alerts.application[each.key]
  id       = each.key
}
import {
  for_each = local.application_repositories
  to       = github_repository_dependabot_security_updates.application[each.key]
  id       = each.key
}
import {
  for_each = local.application_repositories
  to       = github_repository_collaborators.application[each.key]
  id       = each.key
}
import {
  for_each = local.application_repositories
  to       = github_issue_labels.application[each.key]
  id       = each.key
}
import {
  for_each = local.application_environments
  to       = github_repository_environment.application[each.key]
  id       = "${each.value.repository}:${each.value.environment}"
}
import {
  for_each = local.existing_repository_secrets
  to       = github_actions_secret.repository[each.key]
  id       = "${each.value.repository}:${each.value.name}"
}
import {
  to = github_repository_ruleset.mockingbird_main
  id = "mockingbird:23647164"
}

resource "github_repository" "workspace" {
  name                        = split("/", local.config.github.infra_repo)[1]
  description                 = local.merge_gate.repo_settings.description
  homepage_url                = local.merge_gate.repo_settings.homepage
  visibility                  = local.merge_gate.repo_settings.visibility
  archived                    = local.merge_gate.repo_settings.archived
  topics                      = local.merge_gate.repo_settings.topics
  has_issues                  = local.merge_gate.repo_settings.has_issues
  has_projects                = local.merge_gate.repo_settings.has_projects
  has_wiki                    = local.merge_gate.repo_settings.has_wiki
  has_discussions             = local.merge_gate.repo_settings.has_discussions
  is_template                 = local.merge_gate.repo_settings.is_template
  web_commit_signoff_required = local.merge_gate.repo_settings.web_commit_signoff_required
  allow_forking               = local.merge_gate.repo_settings.allow_forking
  merge_commit_title          = local.merge_gate.repo_settings.merge_commit_title
  merge_commit_message        = local.merge_gate.repo_settings.merge_commit_message
  allow_merge_commit          = local.merge_gate.repo_settings.allow_merge_commit
  allow_squash_merge          = local.merge_gate.repo_settings.allow_squash_merge
  allow_rebase_merge          = local.merge_gate.repo_settings.allow_rebase_merge
  allow_auto_merge            = local.merge_gate.repo_settings.allow_auto_merge
  allow_update_branch         = local.merge_gate.repo_settings.allow_update_branch
  delete_branch_on_merge      = local.merge_gate.repo_settings.delete_branch_on_merge
  security_and_analysis {
    secret_scanning {
      status = local.merge_gate.repo_settings.security_and_analysis.secret_scanning.status
    }
    secret_scanning_push_protection {
      status = local.merge_gate.repo_settings.security_and_analysis.secret_scanning_push_protection.status
    }
    secret_scanning_non_provider_patterns {
      status = local.merge_gate.repo_settings.security_and_analysis.secret_scanning_non_provider_patterns.status
    }
  }
  lifecycle { prevent_destroy = true }
}

resource "github_actions_repository_permissions" "workspace" {
  repository           = github_repository.workspace.name
  enabled              = local.merge_gate.actions.enabled
  allowed_actions      = local.merge_gate.actions.allowed_actions
  sha_pinning_required = local.merge_gate.actions.sha_pinning_required
}

resource "github_workflow_repository_permissions" "workspace" {
  repository                       = github_repository.workspace.name
  default_workflow_permissions     = local.merge_gate.actions.default_workflow_permissions
  can_approve_pull_request_reviews = local.merge_gate.actions.can_approve_pull_request_reviews
}

# GitHub represents disabled vulnerability alerts as a 404, so there is no
# provider resource to import. The first reviewed apply creates the resource by
# enabling alerts; subsequent plans detect drift normally.
resource "github_repository_vulnerability_alerts" "workspace" {
  repository = github_repository.workspace.name
  enabled    = local.merge_gate.security.vulnerability_alerts
}

resource "github_repository_dependabot_security_updates" "workspace" {
  repository = github_repository.workspace.name
  enabled    = local.merge_gate.security.dependabot_security_updates
  depends_on = [github_repository_vulnerability_alerts.workspace]
}

resource "github_repository_collaborators" "workspace" {
  repository = github_repository.workspace.name
  dynamic "user" {
    for_each = { for collaborator in local.merge_gate.collaborators : collaborator.username => collaborator }
    content {
      username   = user.value.username
      permission = user.value.permission
    }
  }
}

resource "github_issue_labels" "workspace" {
  repository = github_repository.workspace.name
  dynamic "label" {
    for_each = { for label in local.merge_gate.labels : label.name => label }
    content {
      name        = label.value.name
      color       = label.value.color
      description = label.value.description
    }
  }
}

resource "github_branch_default" "main" {
  repository = github_repository.workspace.name
  branch     = local.merge_gate.repo_settings.default_branch
}
resource "github_repository_ruleset" "main" {
  repository  = github_repository.workspace.name
  name        = local.merge_gate.ruleset.name
  target      = local.merge_gate.ruleset.target
  enforcement = local.merge_gate.ruleset.enforcement
  conditions {
    ref_name {
      include = local.merge_gate.ruleset.conditions.ref_name.include
      exclude = local.merge_gate.ruleset.conditions.ref_name.exclude
    }
  }
  rules {
    deletion         = true
    non_fast_forward = true
    pull_request {
      allowed_merge_methods             = local.pr_rule.allowed_merge_methods
      dismiss_stale_reviews_on_push     = local.pr_rule.dismiss_stale_reviews_on_push
      require_code_owner_review         = local.pr_rule.require_code_owner_review
      require_last_push_approval        = local.pr_rule.require_last_push_approval
      required_approving_review_count   = local.pr_rule.required_approving_review_count
      required_review_thread_resolution = local.pr_rule.required_review_thread_resolution
    }
    required_status_checks {
      strict_required_status_checks_policy = local.check_rule.strict_required_status_checks_policy
      dynamic "required_check" {
        for_each = local.check_rule.required_status_checks
        content {
          context        = required_check.value.context
          integration_id = required_check.value.integration_id
        }
      }
    }
  }
}

import {
  to = github_repository.workspace
  id = "workspace"
}
import {
  to = github_branch_default.main
  id = "workspace"
}
import {
  to = github_repository_ruleset.main
  id = "workspace:23686210"
}
import {
  to = github_actions_repository_permissions.workspace
  id = "workspace"
}
import {
  to = github_workflow_repository_permissions.workspace
  id = "workspace"
}
import {
  to = github_repository_collaborators.workspace
  id = "workspace"
}
import {
  to = github_issue_labels.workspace
  id = "workspace"
}
import {
  to = github_repository_dependabot_security_updates.workspace
  id = "workspace"
}
