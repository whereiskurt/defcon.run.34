# Include skip check for regional resources
include "skip" {
  path   = "${find_in_parent_folders("region")}/skip.hcl"
  expose = true
}

# Read site config to check if dynamodb is enabled
locals {
  site_vars = read_terragrunt_config(find_in_parent_folders("site.hcl"))
}

# Skip if dynamodb is disabled OR if region should be skipped
skip = !local.site_vars.locals.dynamodb.enabled || include.skip.locals.should_skip

include "module" {
  path   = "${find_in_parent_folders("modules")}/dynamodb/config.hcl"
  expose = true
}

include "providers" {
  path = "${find_in_parent_folders("providers")}/regional.hcl"
}

terraform {
  source = "${include.module.locals.module_path}/v1.0.0"
}

# Ensure primary region (us-east-1) completes first before this replica region runs
# This prevents race conditions when reading replicated tables via data sources
dependency "primary_region_dynamodb" {
  config_path = "../../us-east-1/dynamodb"

  # Don't fail if the primary region hasn't been applied yet
  skip_outputs = true
}

inputs = include.module.locals.merged_inputs
