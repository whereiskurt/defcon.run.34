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