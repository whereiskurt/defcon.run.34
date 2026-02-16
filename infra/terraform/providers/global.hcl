locals {
  ## Global resource state/lock terraform location
  region       = "us-east-1"
  region_label = "use1"

  # Detect CI environment (GitHub Actions sets CI=true)
  is_ci = get_env("CI", "") == "true"

  # Read site config for parameterized values
  site_config = read_terragrunt_config(find_in_parent_folders("site.hcl", "${get_terragrunt_dir()}/site.hcl"))

  # Management account for cross-account Route53 access
  management_account_id    = get_env("TF_VAR_MANAGEMENT_ACCOUNT_ID", "000000000000")
  management_delegate_role = "${local.site_config.locals.site.label}-github-delegate"

  # AWS profile prefix from environment variable TF_VAR_profile_prefix
  # Can be set via: export TF_VAR_profile_prefix="dc" or export TF_VAR_profile_prefix="gr"
  # If not set or empty, no prefix is used
  profile_prefix = get_env("TF_VAR_profile_prefix", "")

  # Construct profile names with optional prefix
  # If prefix is empty or "", returns profile name as-is
  # Otherwise returns "prefix-profile"
  # In CI, profiles are not used (credentials come from environment)
  application_profile = local.profile_prefix != "" ? "${local.profile_prefix}-application" : "application"
  management_profile  = local.profile_prefix != "" ? "${local.profile_prefix}-management" : "management"
  terraform_profile   = local.profile_prefix != "" ? "${local.profile_prefix}-terraform" : "terraform"

  # Generate profile line only when not in CI
  application_profile_line = local.is_ci ? "" : "profile = \"${local.application_profile}\""
  management_profile_line  = local.is_ci ? "" : "profile = \"${local.management_profile}\""
  terraform_profile_line   = local.is_ci ? "" : "profile = \"${local.terraform_profile}\""

  # In CI, management provider uses assume_role to cross-account delegate role
  management_assume_role_block = local.is_ci ? "assume_role {\n      role_arn     = \"arn:aws:iam::${local.management_account_id}:role/${local.management_delegate_role}\"\n      external_id  = \"${local.site_config.locals.site.label}\"\n    }" : ""
}

generate "provider" {
  path      = "provider.tf"
  if_exists = "overwrite_terragrunt"
  contents  = <<EOF
    provider "aws" {
      # Default provider for global resources
      region = "us-east-1"
      ${local.application_profile_line}
    }
    provider "aws" {
      alias   = "global-application"
      region = "us-east-1"
      ${local.application_profile_line}
    }
    provider "aws" {
      alias   = "global-management"
      region = "us-east-1"
      ${local.management_profile_line}
      ${local.management_assume_role_block}
    }
    provider "aws" {
      alias   = "terraform"
      region = "${local.region}"
      ${local.terraform_profile_line}
    }
    # Regional providers for S3 bucket policy operations
    # (bucket policies must be applied via the correct regional endpoint)
    provider "aws" {
      alias   = "use1"
      region  = "us-east-1"
      ${local.application_profile_line}
    }
    provider "aws" {
      alias   = "cac1"
      region  = "ca-central-1"
      ${local.application_profile_line}
    }
    provider "aws" {
      alias   = "apse1"
      region  = "ap-southeast-1"
      ${local.application_profile_line}
    }
    terraform {
      required_providers {
        random = {
          source  = "hashicorp/random"
          version = "~> 3.6"
        }
        aws = {
          source  = "hashicorp/aws"
          version = ">= 4.0"
        }
      }
    }
EOF
}

## The setup below relies on the AWS terraform profile
remote_state {
  backend = "s3"
  config = merge(
    {
      encrypt        = true
      bucket         = get_env(upper("TG_BUCKET_${local.region_label}"), "")
      key            = "${local.region_label}/${path_relative_to_include()}/tf.global.tfstate"
      region         = local.region
      dynamodb_table = get_env(upper("TG_TABLE_${local.region_label}"), "")
    },
    local.is_ci ? {} : { profile = local.terraform_profile }
  )
  generate = {
    path      = "backend.globals.tf"
    if_exists = "overwrite_terragrunt"
  }
}