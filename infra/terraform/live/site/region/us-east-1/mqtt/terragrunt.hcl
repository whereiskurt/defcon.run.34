# Include skip check for regional resources
include "skip" {
  path   = "${find_in_parent_folders("region")}/skip.hcl"
  expose = true
}

# Read site config to check if mqtt is enabled
locals {
  site_vars = read_terragrunt_config(find_in_parent_folders("site.hcl"))
  _zone     = local.site_vars.locals.dns.zonename
  _subs     = local.site_vars.locals.dns.subdomains
  _mock_ns  = ["ns-0.awsdns-00.com"]
}

# Exclude if ECS services are disabled OR if region should be skipped
exclude {
  if      = !local.site_vars.locals.ecs_services.enabled || include.skip.locals.should_skip
  actions = ["all"]
}

dependency "network" {
  config_path = "../network"

  mock_outputs = {
    nlb_dns_name = "mock-nlb.us-east-1.elb.amazonaws.com"
    nlb_zone_id  = "Z26RNL4JYFTOTI"
  }
  mock_outputs_allowed_terraform_commands = ["init", "validate", "plan", "destroy"]
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

include "providers" {
  path   = "${find_in_parent_folders("providers")}/regional.hcl"
  expose = true
}

terraform {
  source = "."
}

inputs = {
  site = {
    label         = local.site_vars.locals.site.label
    random_suffix = local.site_vars.locals.site.random_suffix
  }
  region = {
    label = include.providers.locals.region_label
    full  = include.providers.locals.region
  }
  nlb_dns_name = dependency.network.outputs.nlb_dns_name
  nlb_zone_id  = dependency.network.outputs.nlb_zone_id
  mqtt_zone_id = dependency.site.outputs.zone_map["mqtt.${local._zone}"].zone_id
  dns_zonename = local._zone
}
