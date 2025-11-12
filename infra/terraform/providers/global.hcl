locals {
  ## Global resource state/lock terraform location
  region = "us-east-1"
  region_label = "use1"
}

generate "provider" {
  path      = "provider.tf"
  if_exists = "overwrite_terragrunt"
  contents  = <<EOF
    provider "aws" {
      alias   = "global-application"
      region = "us-east-1"
      profile = "application"
    }
    provider "aws" {
      alias   = "global-management"
      region = "us-east-1"
      profile = "management"
    }
    provider "aws" {
      alias   = "terraform"
      region = "${local.region}"
      profile = "teraform"
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
    key            = "${local.region_label}/tf.global.tfstate"
    region         = local.region
    dynamodb_table = get_env(upper("TG_TABLE_${local.region_label}"), "")
    profile        = "terraform"
  }
  generate = {
    path      = "backend.globals.tf"
    if_exists = "overwrite_terragrunt"
  }
}