# Include skip check for regional resources
include "skip" {
  path   = "${find_in_parent_folders("region")}/skip.hcl"
  expose = true
}

# Read site config to check if ecs_services is enabled
locals {
  site_vars = read_terragrunt_config(find_in_parent_folders("site.hcl"))
}

# Exclude if ecs_services is disabled OR if region should be skipped (Terragrunt 0.96+)
exclude {
  if      = !local.site_vars.locals.ecs_services.enabled || include.skip.locals.should_skip
  actions = ["all"]
}

dependency "ecs_task" {
  config_path = "../ecs-task"

  mock_outputs = {
    task_definition_arns = {
      "run-auth"       = "arn:aws:ecs:us-east-1:123456789012:task-definition/run-auth-apse1-example-site:1"
      "run-human"      = "arn:aws:ecs:us-east-1:123456789012:task-definition/run-human-apse1-example-site:1"
      "run-cms-master" = "arn:aws:ecs:us-east-1:123456789012:task-definition/run-cms-master-apse1-example-site:1"
      "run-cms-worker" = "arn:aws:ecs:us-east-1:123456789012:task-definition/run-cms-worker-apse1-example-site:1"
      "run-gpx"        = "arn:aws:ecs:us-east-1:123456789012:task-definition/run-gpx-apse1-example-site:1"
    }
  }
  mock_outputs_allowed_terraform_commands = ["init", "validate", "plan", "destroy"]
}

dependency "ecs_cluster" {
  config_path = "../ecs-cluster"

  mock_outputs = {
    clusters = {
      "app" = {
        cluster_id     = "arn:aws:ecs:us-east-1:123456789012:cluster/app-apse1-example-site"
        cluster_name   = "app-apse1-example-site"
        cluster_arn    = "arn:aws:ecs:us-east-1:123456789012:cluster/app-apse1-example-site"
        namespace_id   = "ns-mock"
        namespace_name = "app-apse1-example-site.local"
      }
    }
  }
  mock_outputs_allowed_terraform_commands = ["init", "validate", "plan", "destroy"]
}

dependency "network" {
  config_path = "../network"

  mock_outputs = {
    vpc_id             = "vpc-mock123"
    private_subnet_ids = ["subnet-private1", "subnet-private2"]
    public_subnet_ids  = ["subnet-public1", "subnet-public2"]
    security_group_ids = ["sg-mock123"]
    alb_arn            = "arn:aws:elasticloadbalancing:us-east-1:123456789012:loadbalancer/app/mock-alb/abc123"
    alb_listener_arn   = "arn:aws:elasticloadbalancing:us-east-1:123456789012:listener/app/mock-alb/abc123/def456"
    nlb_arn            = null
  }
  mock_outputs_allowed_terraform_commands = ["init", "validate", "plan", "destroy"]
}

include "module" {
  path   = "${find_in_parent_folders("modules")}/ecs-service/config.hcl"
  expose = true
}

include "providers" {
  path = "${find_in_parent_folders("providers")}/regional.hcl"
}

terraform {
  source = "${include.module.locals.module_path}/v1.0.0"
}

inputs = merge(
  include.module.locals.merged_inputs,
  {
    # Task definitions from ecs-task module
    task_definitions = dependency.ecs_task.outputs.task_definition_arns

    # Cluster information from ecs-cluster module
    clusters = dependency.ecs_cluster.outputs.clusters

    # Network resources from network module
    vpc_id             = dependency.network.outputs.vpc_id
    private_subnet_ids = dependency.network.outputs.private_subnet_ids
    public_subnet_ids  = dependency.network.outputs.public_subnet_ids
    security_group_ids = dependency.network.outputs.security_group_ids
    alb_arn            = try(dependency.network.outputs.alb_arn, "")
    alb_listener_arn   = try(dependency.network.outputs.alb_listener_arn, "")
    nlb_arn            = try(dependency.network.outputs.nlb_arn, "")
  }
)
