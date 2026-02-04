# Include skip check for regional resources
include "skip" {
  path   = "${find_in_parent_folders("region")}/skip.hcl"
  expose = true
}

# Read site config to check if ec2spots is enabled
# Note: locals block consolidated with ec2spot_vars below

# Exclude if ec2spots is disabled OR if region should be skipped (Terragrunt 0.96+)
exclude {
  if      = !local.site_vars.locals.ec2spots.enabled || include.skip.locals.should_skip
  actions = ["all"]
}

dependency "network" {
  config_path = "../network"

  mock_outputs = {
    vpc_id             = "vpc-mock"
    public_subnets     = ["subnet-mock-1", "subnet-mock-2"]
    availability_zones = ["us-east-1a", "us-east-1b"]
  }
  mock_outputs_allowed_terraform_commands = ["init", "validate", "plan", "destroy"]
}

dependency "site" {
  config_path = dirname(find_in_parent_folders("site.hcl"))

  mock_outputs = {
    zone_map = {
      "example.com" = {
        zone_id      = "Z0000000000000000000"
        name         = "example.com"
        name_servers = ["ns-0.awsdns-00.com"]
      }
      "run.example.com" = {
        zone_id      = "Z0000000000000000002"
        name         = "run.example.com"
        name_servers = ["ns-0.awsdns-00.com"]
      }
    }
  }
  mock_outputs_allowed_terraform_commands = ["init", "validate", "plan", "destroy"]
}

include "module" {
  path   = "${find_in_parent_folders("modules")}/ec2spot/config.hcl"
  expose = true
}

include "providers" {
  path = "${find_in_parent_folders("providers")}/regional.hcl"
}

terraform {
  source = "${include.module.locals.module_path}/v1.0.0"
}

locals {
  site_vars    = read_terragrunt_config(find_in_parent_folders("site.hcl"))
  ec2spot_vars = read_terragrunt_config("ec2spot.hcl")
}

inputs = merge(
  include.module.locals.merged_inputs,
  {
    vpc_id             = dependency.network.outputs.vpc_id
    public_subnets     = dependency.network.outputs.public_subnets
    availability_zones = dependency.network.outputs.availability_zones
    zone_map           = dependency.site.outputs.zone_map
  }
)
