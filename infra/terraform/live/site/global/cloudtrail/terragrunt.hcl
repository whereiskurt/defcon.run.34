# Read site config to check if cloudtrail is enabled
locals {
  site_vars = read_terragrunt_config(find_in_parent_folders("site.hcl"))
}

# Exclude if cloudtrail is disabled (Terragrunt 0.96+)
exclude {
  if      = !try(local.site_vars.locals.cloudtrail.enabled, false)
  actions = ["all"]
}

include "module" {
  path   = "${find_in_parent_folders("modules")}/cloudtrail/config.hcl"
  expose = true
}

include "providers" {
  path = "${find_in_parent_folders("providers")}/global.hcl"
}

terraform {
  source = "${include.module.locals.module_path}/v1.0.0"
}

inputs = include.module.locals.merged_inputs
