# Include skip check for regional resources
include "skip" {
  path   = "${find_in_parent_folders("region")}/skip.hcl"
  expose = true
}

# Read site config to check if user_uploads is enabled
locals {
  site_vars = read_terragrunt_config(find_in_parent_folders("site.hcl"))
}

# Exclude if user_uploads is disabled OR if region should be skipped (Terragrunt 0.96+)
exclude {
  if      = !local.site_vars.locals.user_uploads.enabled || include.skip.locals.should_skip
  actions = ["all"]
}

include "module" {
  path   = "${find_in_parent_folders("modules")}/s3-uploads/config.hcl"
  expose = true
}

# Ensure IAM policy is updated before S3 operations
dependency "github_oidc" {
  config_path = "${find_in_parent_folders("site")}/global/github-oidc"
  mock_outputs = {
    role_arns = {}
  }
  mock_outputs_allowed_terraform_commands = ["validate", "plan"]
}

include "providers" {
  path = "${find_in_parent_folders("providers")}/regional.hcl"
}

terraform {
  source = "${include.module.locals.module_path}/v1.0.0"
}

inputs = include.module.locals.merged_inputs
