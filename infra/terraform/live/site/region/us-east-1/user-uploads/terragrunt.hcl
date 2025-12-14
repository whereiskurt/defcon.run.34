# Include skip check for regional resources
include "skip" {
  path   = "${find_in_parent_folders("region")}/skip.hcl"
  expose = true
}

# Read site config to check if user_uploads is enabled
locals {
  site_vars = read_terragrunt_config(find_in_parent_folders("site.hcl"))
}

# Skip if user_uploads is disabled OR if region should be skipped
skip = !local.site_vars.locals.user_uploads.enabled || include.skip.locals.should_skip

include "module" {
  path   = "${find_in_parent_folders("modules")}/user-uploads/config.hcl"
  expose = true
}

include "providers" {
  path = "${find_in_parent_folders("providers")}/regional.hcl"
}

terraform {
  source = "${include.module.locals.module_path}/v1.0.0"
}

inputs = include.module.locals.merged_inputs
