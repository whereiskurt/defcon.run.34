# Include skip check for regional resources
include "skip" {
  path   = "${find_in_parent_folders("region")}/skip.hcl"
  expose = true
}

# Read site config to check if dynamodb is enabled
locals {
  site_vars = read_terragrunt_config(find_in_parent_folders("site.hcl"))
}

# Exclude if dynamodb is disabled OR if region should be skipped (Terragrunt 0.96+)
exclude {
  if      = !local.site_vars.locals.dynamodb.enabled || include.skip.locals.should_skip
  actions = ["all"]
}

# Depend on us-east-1 DynamoDB (primary region) for global table replicas
# Tables must be created in primary region first before replicas can be looked up
dependency "use1_dynamodb" {
  config_path  = "../../us-east-1/dynamodb"
  skip_outputs = true

  mock_outputs_allowed_terraform_commands = ["validate", "plan"]
  mock_outputs = {}
}

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

inputs = include.module.locals.merged_inputs
