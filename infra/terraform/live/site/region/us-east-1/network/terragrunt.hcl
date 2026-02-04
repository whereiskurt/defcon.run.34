# Include skip check for regional resources
include "skip" {
  path   = "${find_in_parent_folders("region")}/skip.hcl"
  expose = true
}

dependency "certs" {
  config_path = "../certs"

  mock_outputs = {
    cert_map = {
      "example.com" = {
        arn                       = "arn:aws:acm:us-east-1:123456789012:certificate/mock-cert-id"
        domain_name               = "example.com"
        subject_alternative_names = ["*.example.com"]
        validation_method         = "DNS"
      }
    }
  }
  mock_outputs_allowed_terraform_commands = ["init", "validate", "plan", "destroy"]
}

include "module" {
  path   = "${find_in_parent_folders("modules")}/network/config.hcl"
  expose = true
}

include "providers" {
  path = "${find_in_parent_folders("providers")}/regional.hcl"
}

terraform {
  source = "${include.module.locals.module_path}/v1.0.0"
}

locals {
  network_vars = read_terragrunt_config("network.hcl")
}

inputs = merge(
  include.module.locals.merged_inputs,
  local.network_vars.locals.network,
  {
    cert_map = dependency.certs.outputs.cert_map
  }
)
