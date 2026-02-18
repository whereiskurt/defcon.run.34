# Include skip check for regional resources
include "skip" {
  path   = "${find_in_parent_folders("region")}/skip.hcl"
  expose = true
}

locals {
  _site    = read_terragrunt_config(find_in_parent_folders("site.hcl"))
  _zone    = local._site.locals.dns.zonename
  _subs    = local._site.locals.dns.subdomains
  _mock_ns = ["ns-0.awsdns-00.com"]
}

dependency "site" {
  config_path = dirname(find_in_parent_folders("site.hcl"))

  mock_outputs = {
    zone_map = merge(
      {
        (local._zone) = {
          zone_id      = "Z0000000000000000000"
          name         = local._zone
          name_servers = local._mock_ns
        }
      },
      {
        for i, sub in local._subs :
        "${sub}.${local._zone}" => {
          zone_id      = format("Z%019d", i + 1)
          name         = "${sub}.${local._zone}"
          name_servers = local._mock_ns
        }
      }
    )
  }
  mock_outputs_allowed_terraform_commands = ["init", "validate", "plan", "destroy"]
}

include "module" {
  path   = "${find_in_parent_folders("modules")}/certs/config.hcl"
  expose = true
}

include "providers" {
  path   = "${find_in_parent_folders("providers")}/regional.hcl"
  expose = true
}

terraform {
  source = "${include.module.locals.module_path}/v1.0.0"
}

inputs = merge(
  include.module.locals.merged_inputs,
  {
    zone_map       = dependency.site.outputs.zone_map
    make_site_cert = true
    region = {
      label = include.providers.locals.region_label
      full  = include.providers.locals.region
    }
  }
)
