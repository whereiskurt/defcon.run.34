# Include skip check for regional resources
include "skip" {
  path   = "${find_in_parent_folders("region")}/skip.hcl"
  expose = true
}

# Read site config to check if email is enabled
locals {
  site_vars = read_terragrunt_config(find_in_parent_folders("site.hcl"))
}

# Exclude if email is disabled OR if region should be skipped
exclude {
  if      = !local.site_vars.locals.email.enabled || include.skip.locals.should_skip
  actions = ["all"]
}

include "module" {
  path   = "${find_in_parent_folders("modules")}/email-s3-replication/config.hcl"
  expose = true
}

include "providers" {
  path = "${find_in_parent_folders("providers")}/regional.hcl"
}

terraform {
  source = "${include.module.locals.module_path}/v1.0.0"
}

# Local email — source bucket info
dependency "email" {
  config_path = "../email"

  mock_outputs_allowed_terraform_commands = ["init", "validate", "plan", "destroy"]
  mock_outputs = {
    received_emails_bucket_name = "mock-bucket"
    received_emails_bucket_arn  = "arn:aws:s3:::mock-bucket"
  }
}

# Cross-region dependencies — ensure ALL destination buckets exist before replication
# We don't need their outputs, just ordering
dependency "email_use1" {
  config_path  = "../../us-east-1/email"
  skip_outputs = true
}

dependency "email_cac1" {
  config_path  = "../../ca-central-1/email"
  skip_outputs = true
}

inputs = merge(
  include.module.locals.merged_inputs,
  {
    source_bucket = {
      name = dependency.email.outputs.received_emails_bucket_name
      arn  = dependency.email.outputs.received_emails_bucket_arn
    }
  }
)
