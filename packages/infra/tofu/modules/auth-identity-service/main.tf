# Private-only OIDC engine. Public ingress belongs exclusively to Hono.
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
  # Provider 0.6.2 creates the replica count but cannot change it afterwards (the
  # update leaves the count unchanged and fails the consistency check), so the
  # settings mutation below owns it after creation.
  lifecycle {
    prevent_destroy = true
    ignore_changes  = [regions]
  }
}

# The Railway provider does not expose these per-environment settings. The
# GraphQL provider owns their create/read/update lifecycle and detects drift.
# There are no shell provisioners or API controllers outside OpenTofu.
locals {
  update_settings = <<-GRAPHQL
    mutation Settings($serviceId: String!, $environmentId: String!, $healthcheckPath: String, $sleepApplication: Boolean!, $startCommand: String, $multiRegionConfig: JSON!) {
      serviceInstanceUpdate(serviceId: $serviceId, environmentId: $environmentId, input: {
        autoInstrumentationEnabled: false
        buildCommand: null
        builder: RAILPACK
        cronSchedule: null
        dockerfilePath: null
        drainingSeconds: null
        healthcheckPath: $healthcheckPath
        healthcheckTimeout: null
        ipv6EgressEnabled: false
        multiRegionConfig: $multiRegionConfig
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
    serviceId        = railway_service.this.id
    environmentId    = var.environment_id
    healthcheckPath  = try(var.service.railway.health_check, true) ? try(var.service.railway.health_path, var.service.health_path, "/") : "null"
    sleepApplication = jsonencode(try(var.service.railway.sleep, true))
    startCommand     = try(var.service.railway.start_command, "null")
    # Region -> replica count; Railway reads it as a JSON scalar.
    multiRegionConfig = jsonencode({ (var.region) = { numReplicas = try(var.service.railway.replicas, 1) } })
  }
  read_query_variables = {
    serviceId     = railway_service.this.id
    environmentId = var.environment_id
  }
  compute_mutation_keys = {}
  create_mutation       = local.update_settings
  update_mutation       = local.update_settings
  read_query            = <<-GRAPHQL
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
  delete_mutation       = <<-GRAPHQL
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
