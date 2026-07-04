# Self-contained static status site: status.<zonename>  →  S3 + CloudFront + ACM + Route53.
# Deliberately does NOT include the region skip.hcl or the shared global/cloudfront wiring —
# it owns all of its resources and its own state key so it never collides with other units.

locals {
  _site = read_terragrunt_config(find_in_parent_folders("site.hcl"))
  _zone = local._site.locals.dns.zonename
}

# Read-only dependency on the root site module for the apex zone id (management account).
dependency "site" {
  config_path = dirname(find_in_parent_folders("site.hcl"))

  mock_outputs = {
    zone_map = {
      (local._zone) = {
        zone_id      = "Z0000000000000000000"
        name         = local._zone
        name_servers = ["ns-0.awsdns-00.com"]
      }
    }
  }
  mock_outputs_allowed_terraform_commands = ["init", "validate", "plan", "destroy"]
}

include "providers" {
  path   = "${find_in_parent_folders("providers")}/regional.hcl"
  expose = true
}

terraform {
  source = "${dirname(find_in_parent_folders("AGENTS.md"))}/infra/terraform/modules/status-site/v1.0.0"
}

inputs = {
  site = {
    label = local._site.locals.site.label
  }
  dns = {
    zonename = local._zone
  }
  subdomain    = "status"
  region_label = include.providers.locals.region_label
  apex_zone_id = dependency.site.outputs.zone_map[local._zone].zone_id
  price_class  = "PriceClass_100"

  tags = {
    Site      = local._site.locals.site.label
    Component = "status-site"
    ManagedBy = "terragrunt"
  }
}
