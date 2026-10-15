# The Railway provider owns project and environment identity. Railway's API
# exposes the remaining mutable settings only through GraphQL, so these
# resources keep those settings declarative and drift-detectable in OpenTofu.
locals {
  railway_project_settings_mutation = <<-GRAPHQL
    mutation ProjectSettings($projectId: String!) {
      projectUpdate(id: $projectId, input: {
        name: ${jsonencode(local.config.railway.project)}
        description: null
        isPublic: false
        prDeploys: false
        botPrEnvironments: false
        focusedPrEnvironments: true
        baseEnvironmentId: null
      }) { id }
    }
  GRAPHQL
}

resource "graphql_mutation" "railway_project_settings" {
  mutation_variables = {
    projectId = railway_project.workspace.id
  }
  read_query_variables = {
    projectId = railway_project.workspace.id
  }
  compute_mutation_keys = {}
  create_mutation       = local.railway_project_settings_mutation
  update_mutation       = local.railway_project_settings_mutation
  delete_mutation       = local.railway_project_settings_mutation
  delete_mutation_variables = {
    projectId = railway_project.workspace.id
  }
  read_query = <<-GRAPHQL
    query ProjectSettings($projectId: String!) {
      project(id: $projectId) {
        id
        name
        description
        isPublic
        prDeploys
        botPrEnvironments
        focusedPrEnvironments
        baseEnvironmentId
      }
    }
  GRAPHQL
}

locals {
  railway_clearance_mutation = <<-GRAPHQL
    mutation EnvironmentClearance($projectId: String!, $environmentId: String!) {
      environmentClearanceDefaultUpdate(input: { projectId: $projectId, environmentId: $environmentId, enabled: false })
    }
  GRAPHQL
}

resource "graphql_mutation" "railway_environment_clearance" {
  mutation_variables = {
    projectId     = railway_project.workspace.id
    environmentId = railway_project.workspace.default_environment.id
  }
  read_query_variables = {
    environmentId = railway_project.workspace.default_environment.id
  }
  compute_mutation_keys = {}
  create_mutation       = local.railway_clearance_mutation
  update_mutation       = local.railway_clearance_mutation
  delete_mutation       = local.railway_clearance_mutation
  delete_mutation_variables = {
    projectId     = railway_project.workspace.id
    environmentId = railway_project.workspace.default_environment.id
  }
  read_query = <<-GRAPHQL
    query EnvironmentClearance($environmentId: String!) {
      environment(id: $environmentId) {
        id
        projectId
        clearanceDefault
      }
    }
  GRAPHQL
}
