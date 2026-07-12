# q.defcon.run QR resolver live unit (QR service Phase 2-4).
#
# Provisions the resolver + rollup Lambdas, their IAM/log groups/cron, AND the
# public front door: ALB->Lambda target group + host listener rule (host_header
# = q.defcon.run) behind a CloudFront distribution. The public ALB accepts 443
# ONLY from the CloudFront prefix list, so q. MUST front through CloudFront
# whose origin is the ALB (Decision 1 = A). enable_transport = true flips that
# ingress on.
#
# HEADER LANDMINE (mirrors bib-reconcile): this unit MUST live under
# region/us-east-1/ because modules/qr-resolver/config.hcl calls
# find_in_parent_folders("region.hcl") to derive region.{label,full}. A path
# outside the region.hcl parent chain would fail to resolve region.
#
# VALIDATION: scoped `terragrunt plan` (needs creds), or the terragrunt-plan.yml
# GH Action with region=us-east-1, modules=qr-resolver.

include "skip" {
  path   = "${find_in_parent_folders("region")}/skip.hcl"
  expose = true
}

locals {
  site_vars = read_terragrunt_config(find_in_parent_folders("site.hcl"))
}

# Skip when the region is in site.skip_regions (mirrors bib-reconcile).
exclude {
  if      = include.skip.locals.should_skip
  actions = ["all"]
}

include "module" {
  path   = "${find_in_parent_folders("modules")}/qr-resolver/config.hcl"
  expose = true
}

include "providers" {
  path   = "${find_in_parent_folders("providers")}/regional.hcl"
  expose = true
}

# Package node_modules/ into the Lambda source dirs before archiving. The
# module's archive_file zips the source dir as-is, so `npm ci --omit=dev` must
# run first (Terraform does not npm-install). Runs on init/plan/apply.
terraform {
  source = "${include.module.locals.module_path}/v1.0.0"

  before_hook "npm_ci_resolver" {
    commands    = ["init", "plan", "apply"]
    execute     = ["npm", "ci", "--omit=dev"]
    working_dir = "${get_repo_root()}/apps/run.qr/lambda/resolver"
  }

  before_hook "npm_ci_rollup" {
    commands    = ["init", "plan", "apply"]
    execute     = ["npm", "ci", "--omit=dev"]
    working_dir = "${get_repo_root()}/apps/run.qr/lambda/rollup"
  }
}

# Shared ALB HTTPS listener + ALB DNS name for the host rule and CloudFront
# origin. Mock outputs mirror the ecs-service unit's network dependency.
dependency "network" {
  config_path = "../network"

  mock_outputs = {
    alb_listener_arn = "arn:aws:elasticloadbalancing:us-east-1:123456789012:listener/app/mock-alb/abc123/def456"
    alb_dns_name     = "mock-alb-1234567890.us-east-1.elb.amazonaws.com"
  }
  mock_outputs_allowed_terraform_commands = ["init", "validate", "plan", "destroy"]
}

# Shared run-human-electro table holding qr/ctf/qrstat entities (mock shape
# mirrors bib-reconcile).
dependency "dynamodb" {
  config_path = "../dynamodb"

  mock_outputs = {
    tables = {
      "run-human-electro" = {
        table_name = "run-human-electro"
        table_arn  = "arn:aws:dynamodb:us-east-1:000000000000:table/run-human-electro"
      }
    }
  }
  mock_outputs_allowed_terraform_commands = ["init", "validate", "plan", "destroy"]
}

# us-east-1 ACM cert (CloudFront requires the cert in us-east-1). The resolver
# host rides the wildcard *.defcon.run SAN, keyed by the apex zonename.
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

# Apex defcon.run hosted zone for the q. ALIAS record.
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

# merged_inputs (from config.hcl) already carries site, dns, region, and the
# resolver/rollup source paths. Layer on the transport wiring + data-layer refs.
inputs = merge(
  include.module.locals.merged_inputs,
  {
    enable_transport = true
    resolver_host    = "q.${local.site_vars.locals.dns.zonename}"

    electro_table_name = dependency.dynamodb.outputs.tables["run-human-electro"].table_name
    electro_table_arn  = dependency.dynamodb.outputs.tables["run-human-electro"].table_arn

    alb_listener_arn = dependency.network.outputs.alb_listener_arn
    alb_dns_name     = dependency.network.outputs.alb_dns_name

    cert_arn = dependency.certs.outputs.cert_map[local.site_vars.locals.dns.zonename].arn
    zone_id  = dependency.site.outputs.zone_map[local.site_vars.locals.dns.zonename].zone_id

    region = {
      label = include.providers.locals.region_label
      full  = include.providers.locals.region
    }

    tags = {
      Site      = local.site_vars.locals.site.label
      Component = "qr-resolver"
      ManagedBy = "terragrunt"
    }
  }
)
