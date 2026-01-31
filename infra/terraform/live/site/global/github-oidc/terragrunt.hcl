# Read site config to check if github_oidc is enabled
locals {
  site_vars = read_terragrunt_config(find_in_parent_folders("site.hcl"))
}

# Exclude if github_oidc is disabled (Terragrunt 0.96+)
exclude {
  if      = !local.site_vars.locals.github_oidc.enabled
  actions = ["all"]
}

# Deploy CloudTrail first so it captures all subsequent infrastructure changes
dependency "cloudtrail" {
  config_path  = "../cloudtrail"
  skip_outputs = true

  mock_outputs_allowed_terraform_commands = ["validate", "plan"]
  mock_outputs = {}
}

include "module" {
  path   = "${find_in_parent_folders("modules")}/github-oidc/config.hcl"
  expose = true
}

include "providers" {
  path = "${find_in_parent_folders("providers")}/global.hcl"
}

terraform {
  source = "${include.module.locals.module_path}/v1.0.0"
}

inputs = include.module.locals.merged_inputs
