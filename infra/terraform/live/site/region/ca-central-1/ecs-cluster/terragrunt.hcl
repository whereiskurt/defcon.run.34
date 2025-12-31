# Include skip check for regional resources
include "skip" {
  path   = "${find_in_parent_folders("region")}/skip.hcl"
  expose = true
}

# Read site config to check if ecs_clusters is enabled
locals {
  site_vars        = read_terragrunt_config(find_in_parent_folders("site.hcl"))
  ecs_cluster_vars = read_terragrunt_config("ecs-cluster.hcl")
}

# Exclude if ecs_clusters is disabled OR if region should be skipped (Terragrunt 0.96+)
exclude {
  if      = !local.site_vars.locals.ecs_clusters.enabled || include.skip.locals.should_skip
  actions = ["all"]
}

dependency "network" {
  config_path = "../network"

  mock_outputs = {
    vpc_id = "vpc-mock"
  }
  mock_outputs_allowed_terraform_commands = ["init", "validate", "plan", "destroy"]
}

include "module" {
  path   = "${find_in_parent_folders("modules")}/ecs-cluster/config.hcl"
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
    vpc_id = dependency.network.outputs.vpc_id
  }
)
