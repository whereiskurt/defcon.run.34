locals {
  ## Global resource state/lock terraform location
  region       = "us-east-1"
  region_label = "use1"

  # AWS profile prefix from environment variable TF_VAR_profile_prefix
  # Can be set via: export TF_VAR_profile_prefix="dc" or export TF_VAR_profile_prefix="gr"
  # If not set or empty, no prefix is used
  profile_prefix = get_env("TF_VAR_profile_prefix", "")

  # Construct profile names with optional prefix
  # If prefix is empty or "", returns profile name as-is
  # Otherwise returns "prefix-profile"
  application_profile = local.profile_prefix != "" ? "${local.profile_prefix}-application" : "application"
  management_profile  = local.profile_prefix != "" ? "${local.profile_prefix}-management" : "management"
  terraform_profile   = "terraform"  # terraform profile never gets a prefix
}

generate "provider" {
  path      = "provider.tf"
  if_exists = "overwrite_terragrunt"
  contents  = <<EOF
    provider "aws" {
      # Default provider for global resources
      region = "us-east-1"
      profile = "${local.application_profile}"
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
    key            = "${local.region_label}/${path_relative_to_include()}/tf.global.tfstate"
    region         = local.region
    dynamodb_table = get_env(upper("TG_TABLE_${local.region_label}"), "")
    profile        = "terraform"
  }
  generate = {
    path      = "backend.globals.tf"
    if_exists = "overwrite_terragrunt"
  }
}