locals {
  resource     = read_terragrunt_config(find_in_parent_folders("region.hcl"))
  region       = try(local.resource.locals.region.full, "us-east-1")
  region_label = try(local.resource.locals.region.label, "use1")

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

#######
## Terragrunt block below generates the providers needed for the different AWS accounts and regions
#########
# The following profiles are used to differentiate between the different AWS accounts and regions.
#   - application - switches between $REGIONS, deploys the workload
#   - global-application - always pined to us-east-1 for CloudFront and global WAF
#   - management - switches between $REGIONS, and used for DNS Zone delegation setup
#   - terraform - keeps the state files in this account
#######
generate "provider" {
  path      = "provider.tf"
  if_exists = "overwrite_terragrunt"
  contents  = <<EOF
    provider "aws" {
      ##Not alias means this is the default provider when not provided
      region = "${local.region}"
      ${local.application_profile_line}
    }
    provider "aws" {
      alias   = "application"
      region = "${local.region}"
      ${local.application_profile_line}
    }
    provider "aws" {
      alias   = "management"
      region = "${local.region}"
      ${local.management_profile_line}
      ${local.management_assume_role_block}
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
      key            = "${local.region_label}/${path_relative_to_include()}/terraform.tfstate"
      region         = local.region
      dynamodb_table = get_env(upper("TG_TABLE_${local.region_label}"), "")
    },
    local.is_ci ? {} : { profile = local.terraform_profile }
  )
  generate = {
    path      = "backend.tf"
    if_exists = "overwrite_terragrunt"
  }
}