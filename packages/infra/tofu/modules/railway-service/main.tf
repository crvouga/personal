terraform {
  required_providers {
    railway    = { source = "terraform-community-providers/railway", version = "= 0.6.2" }
    graphql    = { source = "sullivtr/graphql", version = "= 2.6.2" }
    cloudflare = { source = "cloudflare/cloudflare", version = "= 5.26.0" }
  }
}

variable "project_id" { type = string }
variable "environment_id" { type = string }
variable "zone_id" { type = string }
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
  }
}

# The Railway provider does not expose these per-environment settings. The
# GraphQL provider owns their create/read/update lifecycle and detects drift.
# There are no shell provisioners or API controllers outside OpenTofu.
locals {
  update_settings = <<-GRAPHQL
    mutation Settings($serviceId: String!, $environmentId: String!, $healthcheckPath: String, $sleepApplication: Boolean!, $startCommand: String, $drainingSeconds: Int, $healthcheckTimeout: Int) {
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

resource "railway_custom_domain" "this" {
  domain         = var.service.hostname
  environment_id = var.environment_id
  service_id     = railway_service.this.id
  target_port    = var.service.port
}

resource "cloudflare_dns_record" "traffic" {
  zone_id = var.zone_id
  name    = var.service.hostname
  type    = "CNAME"
  content = railway_custom_domain.this.dns_record_value
  ttl     = 1
  proxied = false
}

resource "cloudflare_dns_record" "verification" {
  zone_id = var.zone_id
  name    = railway_custom_domain.this.verification_host_label
  type    = "TXT"
  content = railway_custom_domain.this.verification_record_value
  ttl     = 1
}

output "id" { value = railway_service.this.id }
