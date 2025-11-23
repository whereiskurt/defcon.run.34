# Include skip check for regional resources
include "skip" {
  path   = "${find_in_parent_folders("region")}/skip.hcl"
  expose = true
}

include "module" {
  path   = "${find_in_parent_folders("modules")}/ecr/config.hcl"
  expose = true
}

include "providers" {
  path = "${find_in_parent_folders("providers")}/regional.hcl"
}

terraform {
  source = "${include.module.locals.module_path}/v1.0.0"
}

locals {
  ecr_vars = read_terragrunt_config("ecr.hcl")
}

inputs = merge(
  include.module.locals.merged_inputs,
  {}
)
