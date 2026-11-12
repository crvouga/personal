# A Railway service reachable only over the project's private network
# (<service id>.railway.internal): no custom domain and no DNS record.
# The settings and variables below are the same as modules/railway-service.
terraform {
  required_providers {
    railway = { source = "terraform-community-providers/railway", version = "= 0.6.2" }
    graphql = { source = "sullivtr/graphql", version = "= 2.6.2" }
  }
}

variable "project_id" { type = string }
variable "environment_id" { type = string }
variable "service" { type = any }
variable "image" { type = string }
variable "region" { type = string }
variable "variables" {
  type      = map(string)
  sensitive = true
}

resource "railway_service" "this" {
  name         = var.service.id
  project_id   = var.project_id
  source_image = var.image
  regions      = [{ region = var.region, num_replicas = try(var.service.railway.replicas, 1) }]
  volume       = try(var.service.railway.volume, null)
  lifecycle {
    prevent_destroy = true
    precondition {
      condition     = try(var.service.railway.volume, null) == null || try(var.service.railway.replicas, 1) == 1
      error_message = "A volume-backed service must run exactly one replica."
    }
    precondition {
      condition     = try(var.service.hostname, null) == null && try(var.service.railway.registry, null) == null
      error_message = "An internal service has no hostname and pulls a public image."
    }
  }
}

# The Railway provider does not expose these per-environment settings. The
# GraphQL provider owns their create/read/update lifecycle and detects drift.
# There are no shell provisioners or API controllers outside OpenTofu.
locals {
  # The Railway provider can reset unmodeled deployment settings when updating
  # the image. Include its revision in the GraphQL operation name so this
  # resource reapplies the declared settings after every image update.
  update_settings = <<-GRAPHQL
    mutation Settings_${substr(sha256(var.image), 0, 12)}($serviceId: String!, $environmentId: String!, $healthcheckPath: String, $sleepApplication: Boolean!, $startCommand: String, $drainingSeconds: Int, $healthcheckTimeout: Int) {
      serviceInstanceUpdate(serviceId: $serviceId, environmentId: $environmentId, input: {
        autoInstrumentationEnabled: false
        buildCommand: null
        builder: RAILPACK
        cronSchedule: null
        dockerfilePath: null
        drainingSeconds: $drainingSeconds
        healthcheckPath: $healthcheckPath
        healthcheckTimeout: $healthcheckTimeout
        ipv6EgressEnabled: false
        overlapSeconds: null
        preDeployCommand: null
        preDeployTimeoutSeconds: null
        railwayConfigFile: null
        restartPolicyMaxRetries: 10
        restartPolicyType: ON_FAILURE
        rootDirectory: null
        sleepApplication: $sleepApplication
        startCommand: $startCommand
        tracingEnabled: false
        watchPatterns: []
      })
    }
  GRAPHQL
}

resource "graphql_mutation" "settings" {
  mutation_variables = {
    serviceId          = railway_service.this.id
    environmentId      = var.environment_id
    healthcheckPath    = try(var.service.railway.health_check, true) ? try(var.service.railway.health_path, var.service.health_path, "/") : "null"
    sleepApplication   = jsonencode(try(var.service.railway.sleep, true))
    startCommand       = try(var.service.railway.start_command, "null")
    drainingSeconds    = jsonencode(try(var.service.railway.draining_seconds, null))
    healthcheckTimeout = jsonencode(try(var.service.railway.health_timeout_seconds, null))
  }
  read_query_variables = {
    serviceId     = railway_service.this.id
    environmentId = var.environment_id
  }
  compute_mutation_keys = {}
  # create_mutation is ForceNew in this provider; keep it stable so an image
  # revision updates settings in place without running the delete/reset mutation.
  create_mutation = replace(local.update_settings, "Settings_${substr(sha256(var.image), 0, 12)}", "Settings")
  update_mutation = local.update_settings
  read_query      = <<-GRAPHQL
    query Settings($serviceId: String!, $environmentId: String!) {
      serviceInstance(serviceId: $serviceId, environmentId: $environmentId) {
        serviceId
        environmentId
        autoInstrumentationEnabled
        buildCommand
        builder
        cronSchedule
        dockerfilePath
        drainingSeconds
        healthcheckPath
        healthcheckTimeout
        ipv6EgressEnabled
        overlapSeconds
        preDeployCommand
        preDeployTimeoutSeconds
        railwayConfigFile
        restartPolicyMaxRetries
        restartPolicyType
        rootDirectory
        sleepApplication
        startCommand
        tracingEnabled
        watchPatterns
      }
    }
  GRAPHQL
  delete_mutation = <<-GRAPHQL
    mutation Reset($serviceId: String!, $environmentId: String!) {
      serviceInstanceUpdate(serviceId: $serviceId, environmentId: $environmentId, input: {
        autoInstrumentationEnabled: false
        buildCommand: null
        builder: RAILPACK
        cronSchedule: null
        dockerfilePath: null
        drainingSeconds: null
        healthcheckPath: null
        healthcheckTimeout: null
        ipv6EgressEnabled: false
        overlapSeconds: null
        preDeployCommand: null
        preDeployTimeoutSeconds: null
        railwayConfigFile: null
        restartPolicyMaxRetries: 10
        restartPolicyType: ON_FAILURE
        rootDirectory: null
        sleepApplication: false
        startCommand: null
        tracingEnabled: false
        watchPatterns: []
      })
    }
  GRAPHQL
  delete_mutation_variables = {
    serviceId     = railway_service.this.id
    environmentId = var.environment_id
  }
}

resource "railway_variable_collection" "this" {
  service_id     = railway_service.this.id
  environment_id = var.environment_id
  variables      = [for name, value in var.variables : { name = name, value = value }]
}

output "id" { value = railway_service.this.id }
