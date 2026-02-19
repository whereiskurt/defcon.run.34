# Include skip check for regional resources
include "skip" {
  path   = "${find_in_parent_folders("region")}/skip.hcl"
  expose = true
}

# Read site config to check if user_uploads is enabled
locals {
  site_vars = read_terragrunt_config(find_in_parent_folders("site.hcl"))
}

# Exclude if user_uploads is disabled OR if region should be skipped
exclude {
  if      = !local.site_vars.locals.user_uploads.enabled || include.skip.locals.should_skip
  actions = ["all"]
}

include "module" {
  path   = "${find_in_parent_folders("modules")}/s3-uploads-replication/config.hcl"
  expose = true
}

include "providers" {
  path = "${find_in_parent_folders("providers")}/regional.hcl"
}

terraform {
  source = "${include.module.locals.module_path}/v1.0.0"
}

# Local s3-uploads — source bucket info
dependency "s3_uploads" {
  config_path = "../s3-uploads"
}

# Cross-region dependencies — ensure ALL destination buckets exist before replication
dependency "s3_uploads_use1" {
  config_path = "../../us-east-1/s3-uploads"

  mock_outputs_allowed_terraform_commands = ["validate", "plan"]
  mock_outputs = {
    buckets = {}
  }
}

dependency "s3_uploads_cac1" {
  config_path = "../../ca-central-1/s3-uploads"

  mock_outputs_allowed_terraform_commands = ["validate", "plan"]
  mock_outputs = {
    buckets = {}
  }
}

inputs = merge(
  include.module.locals.merged_inputs,
  {
    source_buckets = dependency.s3_uploads.outputs.buckets
  }
)
