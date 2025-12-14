# Include skip check for regional resources
include "skip" {
  path   = "${find_in_parent_folders("region")}/skip.hcl"
  expose = true
}

# Read site config to check if upload_processors is enabled
locals {
  site_vars = read_terragrunt_config(find_in_parent_folders("site.hcl"))
}

# Skip if upload_processors is disabled OR if region should be skipped
skip = !local.site_vars.locals.upload_processors.enabled || include.skip.locals.should_skip

include "module" {
  path   = "${find_in_parent_folders("modules")}/s3-uploads-processor/config.hcl"
  expose = true
}

include "providers" {
  path = "${find_in_parent_folders("providers")}/regional.hcl"
}

terraform {
  source = "${include.module.locals.module_path}/v1.0.0"
}

# Dependencies - must have s3-uploads bucket and dynamodb tables created first
dependency "s3_uploads" {
  config_path = "../s3-uploads"

  mock_outputs = {
    buckets = {
      "run-human" = {
        name   = "mock-bucket"
        arn    = "arn:aws:s3:::mock-bucket"
        region = "ca-central-1"
      }
    }
  }

  mock_outputs_allowed_terraform_commands = ["init", "validate", "plan"]
}

dependency "dynamodb" {
  config_path = "../dynamodb"

  mock_outputs = {
    tables = {
      "run-human-electro" = {
        table_name        = "mock-table"
        table_arn         = "arn:aws:dynamodb:ca-central-1:123456789012:table/mock-table"
        table_id          = "mock-table-id"
        stream_arn        = "arn:aws:dynamodb:ca-central-1:123456789012:table/mock-table/stream/2024-01-01T00:00:00.000"
        is_primary_region = false
      }
    }
  }

  mock_outputs_allowed_terraform_commands = ["init", "validate", "plan"]
}

inputs = merge(
  include.module.locals.merged_inputs,
  {
    # Pass actual bucket/table details from dependencies
    s3_uploads_buckets = dependency.s3_uploads.outputs.buckets
    dynamodb_tables      = dependency.dynamodb.outputs.tables
  }
)
