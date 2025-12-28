locals {
  resource     = read_terragrunt_config(find_in_parent_folders("region.hcl"))
  region       = try(local.resource.locals.region.full, "us-east-1")
  region_label = try(local.resource.locals.region.label, "use1")

  # Detect CI environment (GitHub Actions sets CI=true)
  is_ci = get_env("CI", "") == "true"

  # AWS profile prefix from environment variable TF_VAR_profile_prefix
  # Can be set via: export TF_VAR_profile_prefix="dc" or export TF_VAR_profile_prefix="gr"
  # If not set or empty, no prefix is used
  profile_prefix = get_env("TF_VAR_profile_prefix", "")

  # Construct profile names with optional prefix
  # If prefix is empty or "", returns profile name as-is
  # Otherwise returns "prefix-profile"
  # In CI, profiles are not used (credentials come from environment)
  application_profile = local.is_ci ? null : (local.profile_prefix != "" ? "${local.profile_prefix}-application" : "application")
  management_profile  = local.is_ci ? null : (local.profile_prefix != "" ? "${local.profile_prefix}-management" : "management")
  terraform_profile   = local.is_ci ? null : "terraform"
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
      profile = "${local.application_profile}"
    }
    provider "aws" {
      alias   = "application"
      region = "${local.region}"
      profile = "${local.application_profile}"
    }
    provider "aws" {
      alias   = "management"
      region = "${local.region}"
      profile = "${local.management_profile}"
    }
    provider "aws" {
      alias   = "global-application"
      region = "us-east-1"
      profile = "${local.application_profile}"
    }
    provider "aws" {
      alias   = "global-management"
      region = "us-east-1"
      profile = "${local.management_profile}"
    }
    provider "aws" {
      alias   = "terraform"
      region = "${local.region}"
      profile = "${local.terraform_profile}"
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
  config = {
    encrypt        = true
    bucket         = get_env(upper("TG_BUCKET_${local.region_label}"), "")
    key            = "${local.region_label}/${path_relative_to_include()}/terraform.tfstate"
    region         = local.region
    dynamodb_table = get_env(upper("TG_TABLE_${local.region_label}"), "")
    profile        = "terraform"
  }
  generate = {
    path      = "backend.tf"
    if_exists = "overwrite_terragrunt"
  }
}