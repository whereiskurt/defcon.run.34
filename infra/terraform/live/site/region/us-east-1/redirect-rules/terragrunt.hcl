# Vanity host redirects via CloudFront edge functions (QR service Phase 1, fixed):
# r.defcon.run -> YouTube rickroll (302), h.defcon.run -> run.defcon.run (301).
#
# WHY CLOUDFRONT: the public ALB's security group accepts 443 ONLY from the
# CloudFront origin-facing prefix list, so DNS pointing straight at the ALB is
# unreachable (browser connect times out). These hosts must front through
# CloudFront; a viewer-request CloudFront Function returns the redirect at the
# edge and the origin is never contacted.
#
# STATE TRANSITION: this unit previously sourced modules/redirect-rules (ALB
# listener rules + ALIAS->ALB). Re-pointing the source to cloudfront-redirect
# in the SAME unit dir keeps the state key, so a plan destroys the dead ALB
# listener rules and updates the r./h. aws_route53_record.redirect_alias records
# in place from ALB -> CloudFront. The dir name stays "redirect-rules" on purpose
# to preserve that continuity.
#
# SHIPS DARK when site.hcl redirects.enabled = false.
# VALIDATION: scoped `terragrunt plan` (needs creds), or the terragrunt-plan.yml
# GH Action with region=us-east-1, modules=redirect-rules.

locals {
  site_vars = read_terragrunt_config(find_in_parent_folders("site.hcl"))
}

exclude {
  if      = !try(local.site_vars.locals.redirects.enabled, false)
  actions = ["all"]
}

# us-east-1 ACM cert (CloudFront requires the cert in us-east-1). The vanity
# hosts ride the wildcard *.defcon.run SAN, keyed by the apex zonename.
dependency "certs" {
  config_path = "../certs"

  mock_outputs = {
    cert_map = {
      (local.site_vars.locals.dns.zonename) = {
        arn = "arn:aws:acm:us-east-1:123456789012:certificate/mock-cert-id"
      }
    }
  }
  mock_outputs_allowed_terraform_commands = ["init", "validate", "plan", "destroy"]
}

dependency "site" {
  config_path = dirname(find_in_parent_folders("site.hcl"))

  mock_outputs = {
    zone_map = {
      (local.site_vars.locals.dns.zonename) = {
        zone_id      = "Z00000000000000000000"
        name         = local.site_vars.locals.dns.zonename
        name_servers = []
      }
    }
  }
  mock_outputs_allowed_terraform_commands = ["init", "validate", "plan", "destroy"]
}

include "providers" {
  path = "${find_in_parent_folders("providers")}/regional.hcl"
}

terraform {
  source = "${dirname(find_in_parent_folders("AGENTS.md"))}/infra/terraform/modules/cloudfront-redirect/v1.0.0"
}

inputs = {
  site = local.site_vars.locals.site
  region = {
    label = "use1"
    full  = "us-east-1"
  }
  dns = {
    zonename = local.site_vars.locals.dns.zonename
  }

  cert_map  = dependency.certs.outputs.cert_map
  zone_map  = dependency.site.outputs.zone_map
  redirects = local.site_vars.locals.redirects.rules

  tags = {
    Site      = local.site_vars.locals.site.label
    Component = "cloudfront-redirect"
    ManagedBy = "terragrunt"
  }
}
