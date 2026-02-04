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

# Exclude if ecs_tasks is disabled OR if region should be skipped (Terragrunt 0.96+)
exclude {
  if      = !local.site_vars.locals.ecs_tasks.enabled || include.skip.locals.should_skip
  actions = ["all"]
}

dependency "ecs_cluster" {
  config_path = "../ecs-cluster"

  mock_outputs = {
    clusters = {
      "app" = {
        cluster_arn = "arn:aws:ecs:us-east-1:123456789012:cluster/app-use1-example-site"
      }
    }
    task_role_arns = {
      "app" = "arn:aws:iam::123456789012:role/ecs-task-role-app-use1-example-site"
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
    # Inject task_role_arn from ecs-cluster for each task based on its cluster_name
    ecs_tasks = [
      for task in include.module.locals.merged_inputs.ecs_tasks :
      merge(task, {
        task_role_arn = try(dependency.ecs_cluster.outputs.task_role_arns[task.cluster_name], task.task_role_arn)
      })
    ]
  }
)
