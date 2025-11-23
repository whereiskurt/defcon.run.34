# Include skip check for regional resources
include "skip" {
  path   = "${find_in_parent_folders("region")}/skip.hcl"
  expose = true
}

# Read site config to check if email is enabled
locals {
  site_vars = read_terragrunt_config(find_in_parent_folders("site.hcl"))
}

# Skip if email is disabled OR if region should be skipped
skip = !local.site_vars.locals.email.enabled || include.skip.locals.should_skip

dependency "site" {
  config_path = dirname(find_in_parent_folders("site.hcl"))

  mock_outputs = {
    zone_map = {
      "defcon.run" = {
        zone_id      = "Z0000000000000000000"
        name         = "defcon.run"
        name_servers = ["ns-0.awsdns-00.com"]
      }
      "email.defcon.run" = {
        zone_id      = "Z0000000000000000001"
        name         = "email.defcon.run"
        name_servers = ["ns-0.awsdns-00.com"]
      }
      "run.defcon.run" = {
        zone_id      = "Z0000000000000000002"
        name         = "run.defcon.run"
        name_servers = ["ns-0.awsdns-00.com"]
      }
    }
  }
  mock_outputs_allowed_terraform_commands = ["init", "validate", "plan", "destroy"]
}
include "module" {
  path   = "${find_in_parent_folders("modules")}/email/config.hcl"
  expose = true
}

## NOTE: Nested includes are not supported by terragrunt.
##       otherwise we'd consider moving this into module
include "providers" {
  path = "${find_in_parent_folders("providers")}/regional.hcl"
}

terraform {
  source = "${include.module.locals.module_path}/v1.0.0"
}

inputs = merge(
  include.module.locals.merged_inputs,
  {
    zone_map = dependency.site.outputs.zone_map
  }
)
