# Include skip check for regional resources
include "skip" {
  path   = "${find_in_parent_folders("region")}/skip.hcl"
  expose = true
}

dependency "ecs_cluster" {
  config_path = "../ecs-cluster"

  mock_outputs = {
    clusters = {
      "app" = {
        cluster_arn = "arn:aws:ecs:us-east-1:123456789012:cluster/app-use1-defcon-run"
      }
    }
  }
  mock_outputs_allowed_terraform_commands = ["init", "validate", "plan", "destroy"]
}

include "module" {
  path   = "${find_in_parent_folders("modules")}/ecs-task/config.hcl"
  expose = true
}

include "providers" {
  path = "${find_in_parent_folders("providers")}/regional.hcl"
}

terraform {
  source = "${include.module.locals.module_path}/v1.0.0"
}

locals {
  ecs_task_vars = read_terragrunt_config("ecs-task.hcl")
}

inputs = merge(
  include.module.locals.merged_inputs,
  {
    # Task role and execution role can come from ecs-cluster dependency
    # or be specified in site.hcl per task
  }
)
