# Read site config to check if cloudfront is enabled
locals {
  site_vars = read_terragrunt_config(find_in_parent_folders("site.hcl"))
}

# Skip if cloudfront is disabled
skip = !local.site_vars.locals.cloudfront.enabled

dependency "network" {
  config_path = "../network"

  mock_outputs = {
    alb_dns_name = "mock-alb.ca-central-1.elb.amazonaws.com"
    alb_zone_id  = "ZQSVJUPU6J1EY"
  }
  mock_outputs_allowed_terraform_commands = ["init", "validate", "plan", "destroy"]
}

include "module" {
  path   = "${find_in_parent_folders("modules")}/cloudfront-assets/config.hcl"
  expose = true
}

include "providers" {
  path = "${find_in_parent_folders("providers")}/regional.hcl"
}

terraform {
  source = "${include.module.locals.module_path}/v1.0.0"
}

inputs = merge(
  include.module.locals.merged_inputs,
  {
  }
)
