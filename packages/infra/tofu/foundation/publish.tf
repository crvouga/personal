moved {
  from = github_repository_file.publish["crvouga/anime"]
  to   = github_repository_file.publish["anime"]
}

moved {
  from = github_repository_file.publish["crvouga/connect-four"]
  to   = github_repository_file.publish["connect-four"]
}

moved {
  from = github_repository_file.publish["crvouga/headless-combobox"]
  to   = github_repository_file.publish["headless-combobox"]
}

moved {
  from = github_repository_file.publish["crvouga/image-service"]
  to   = github_repository_file.publish["image-service"]
}

moved {
  from = github_repository_file.publish["crvouga/llm-server"]
  to   = github_repository_file.publish["llm-server"]
}

moved {
  from = github_repository_file.publish["crvouga/match-three"]
  to   = github_repository_file.publish["match-three"]
}

moved {
  from = github_repository_file.publish["crvouga/moviefinder.app-clojurescript"]
  to   = github_repository_file.publish["moviefinder.app-clojurescript"]
}

moved {
  from = github_repository_file.publish["crvouga/moviefinder.app-react"]
  to   = github_repository_file.publish["moviefinder.app-react"]
}

moved {
  from = github_repository_file.publish["crvouga/moviefinder.app-rust"]
  to   = github_repository_file.publish["moviefinder.app-rust"]
}

moved {
  from = github_repository_file.publish["crvouga/simon-says"]
  to   = github_repository_file.publish["simon-says"]
}

moved {
  from = github_repository_file.publish["crvouga/snake"]
  to   = github_repository_file.publish["snake"]
}

moved {
  from = github_repository_file.publish["crvouga/todo-v1"]
  to   = github_repository_file.publish["todo-v1"]
}

moved {
  from = github_repository_file.publish["crvouga/mockingbird"]
  to   = github_repository_file.publish["mockingbird"]
}

moved {
  from = github_repository_file.publish["crvouga/violets-garden"]
  to   = github_repository_file.publish["violets-garden"]
}

# Iterate the inventory map. Reading the repository resource object warns on
# every deprecated attribute the provider still exports.
resource "github_repository_file" "publish" {
  for_each            = local.application_repositories
  repository          = github_repository.application[each.key].name
  branch              = each.value.default_branch
  file                = ".github/workflows/publish.yml"
  overwrite_on_create = true
  commit_message      = "ci: manage image publishing with OpenTofu [skip ci]"
  lifecycle { ignore_changes = [commit_message, overwrite_on_create] }
  content = templatefile("${path.module}/../modules/inventory/publish.yml.tftpl", {
    branch       = each.value.default_branch
    infra_repo   = local.config.github.infra_repo
    image_owner  = local.config.image_owner
    image_prefix = local.config.image_prefix
    services = [for service in local.config.services : merge(service, { job_name = replace(service.id, "-", "_") })
      if try(service.github_repo, null) == "${local.config.github.org}/${each.key}"
    ]
  })
}
