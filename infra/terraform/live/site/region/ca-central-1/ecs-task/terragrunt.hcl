# Include skip check for regional resources
include "skip" {
  path   = "${find_in_parent_folders("region")}/skip.hcl"
  expose = true
}

# Read site config to check if ecs_tasks is enabled
locals {
  site_vars     = read_terragrunt_config(find_in_parent_folders("site.hcl"))
  ecs_task_vars = read_terragrunt_config("ecs-task.hcl")
}

# Skip if ecs_tasks is disabled OR if region should be skipped
skip = !local.site_vars.locals.ecs_tasks.enabled || include.skip.locals.should_skip

dependency "ecs_cluster" {
  config_path = "../ecs-cluster"

  mock_outputs = {
    clusters = {
      "app" = {
        cluster_arn = "arn:aws:ecs:ca-central-1:123456789012:cluster/app-cac1-defcon-run"
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

inputs = merge(
  include.module.locals.merged_inputs,
  {
    # Task role and execution role can come from ecs-cluster dependency
    # or be specified in site.hcl per task
  }
)
