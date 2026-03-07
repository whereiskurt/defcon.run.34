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
      "run-auth"       = "arn:aws:ecs:us-east-1:123456789012:task-definition/run-auth-use1-example-site:1"
      "run-human"      = "arn:aws:ecs:us-east-1:123456789012:task-definition/run-human-use1-example-site:1"
      "run-cms-master" = "arn:aws:ecs:us-east-1:123456789012:task-definition/run-cms-master-use1-example-site:1"
      "run-cms-worker" = "arn:aws:ecs:us-east-1:123456789012:task-definition/run-cms-worker-use1-example-site:1"
      "run-gpx"        = "arn:aws:ecs:us-east-1:123456789012:task-definition/run-gpx-use1-example-site:1"
      "run-flash"      = "arn:aws:ecs:us-east-1:123456789012:task-definition/run-flash-use1-example-site:1"
      "run-mqtt"       = "arn:aws:ecs:us-east-1:123456789012:task-definition/run-mqtt-use1-example-site:1"
    }
  }
  mock_outputs_allowed_terraform_commands = ["init", "validate", "plan", "destroy"]
}

dependency "ecs_cluster" {
  config_path = "../ecs-cluster"

  mock_outputs = {
    clusters = {
      "app" = {
        cluster_id     = "arn:aws:ecs:us-east-1:123456789012:cluster/app-use1-example-site"
        cluster_name   = "app-use1-example-site"
        cluster_arn    = "arn:aws:ecs:us-east-1:123456789012:cluster/app-use1-example-site"
        namespace_id   = "ns-mock"
        namespace_name = "app-use1-example-site.local"
      }
    }
  }
  mock_outputs_allowed_terraform_commands = ["init", "validate", "plan", "destroy"]
}

dependency "certs" {
  config_path = "../certs"

  mock_outputs = {
    cert_map = {
      "mqtt.defcon.run" = {
        arn                       = "arn:aws:acm:us-east-1:123456789012:certificate/mock-mqtt-cert"
        domain_name               = "mqtt.defcon.run"
        subject_alternative_names = ["*.mqtt.defcon.run"]
        validation_method         = "DNS"
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
    nlb_arn            = "arn:aws:elasticloadbalancing:us-east-1:123456789012:loadbalancer/net/mock-nlb/abc123"
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

    # Default certificate for NLB TLS listeners (mqtt.defcon.run cert covers MQTT service)
    nlb_default_certificate_arn = try(dependency.certs.outputs.cert_map["mqtt.${local.site_vars.locals.dns.zonename}"].arn, "")
  }
)
