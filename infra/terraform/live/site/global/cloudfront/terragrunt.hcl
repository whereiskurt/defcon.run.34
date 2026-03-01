# Read site config to check if cloudfront is enabled
locals {
  site_vars = read_terragrunt_config(find_in_parent_folders("site.hcl"))
  _zone     = local.site_vars.locals.dns.zonename
  _subs     = local.site_vars.locals.dns.subdomains
  _cf_doms  = local.site_vars.locals.cloudfront.domains
}

# Exclude if cloudfront is disabled (Terragrunt 0.96+)
exclude {
  if      = !local.site_vars.locals.cloudfront.enabled
  actions = ["all"]
}

# Dependencies on regional cloudfront-assets modules
dependency "use1_cloudfront" {
  config_path = "../../region/us-east-1/cloudfront"

  mock_outputs = {
    bucket_ids = {
      run   = "mock-cf-assets-run-use1"
      auth  = "mock-cf-assets-auth-use1"
      cms   = "mock-cf-assets-cms-use1"
      gpx   = "mock-cf-assets-gpx-use1"
      flash = "mock-cf-assets-flash-use1"
    }
    bucket_arns = {
      run   = "arn:aws:s3:::mock-cf-assets-run-use1"
      auth  = "arn:aws:s3:::mock-cf-assets-auth-use1"
      cms   = "arn:aws:s3:::mock-cf-assets-cms-use1"
      gpx   = "arn:aws:s3:::mock-cf-assets-gpx-use1"
      flash = "arn:aws:s3:::mock-cf-assets-flash-use1"
    }
    bucket_regional_domain_names = {
      run   = "mock-cf-assets-run-use1.s3.us-east-1.amazonaws.com"
      auth  = "mock-cf-assets-auth-use1.s3.us-east-1.amazonaws.com"
      cms   = "mock-cf-assets-cms-use1.s3.us-east-1.amazonaws.com"
      gpx   = "mock-cf-assets-gpx-use1.s3.us-east-1.amazonaws.com"
      flash = "mock-cf-assets-flash-use1.s3.us-east-1.amazonaws.com"
    }
    region_label = "use1"
  }
  mock_outputs_allowed_terraform_commands = ["init", "validate", "plan", "destroy"]
}

dependency "cac1_cloudfront" {
  config_path = "../../region/ca-central-1/cloudfront"

  mock_outputs = {
    bucket_ids = {
      run   = "mock-cf-assets-run-cac1"
      auth  = "mock-cf-assets-auth-cac1"
      cms   = "mock-cf-assets-cms-cac1"
      gpx   = "mock-cf-assets-gpx-cac1"
      flash = "mock-cf-assets-flash-cac1"
    }
    bucket_arns = {
      run   = "arn:aws:s3:::mock-cf-assets-run-cac1"
      auth  = "arn:aws:s3:::mock-cf-assets-auth-cac1"
      cms   = "arn:aws:s3:::mock-cf-assets-cms-cac1"
      gpx   = "arn:aws:s3:::mock-cf-assets-gpx-cac1"
      flash = "arn:aws:s3:::mock-cf-assets-flash-cac1"
    }
    bucket_regional_domain_names = {
      run   = "mock-cf-assets-run-cac1.s3.ca-central-1.amazonaws.com"
      auth  = "mock-cf-assets-auth-cac1.s3.ca-central-1.amazonaws.com"
      cms   = "mock-cf-assets-cms-cac1.s3.ca-central-1.amazonaws.com"
      gpx   = "mock-cf-assets-gpx-cac1.s3.ca-central-1.amazonaws.com"
      flash = "mock-cf-assets-flash-cac1.s3.ca-central-1.amazonaws.com"
    }
    region_label = "cac1"
  }
  mock_outputs_allowed_terraform_commands = ["init", "validate", "plan", "destroy", "apply"]
  mock_outputs_merge_strategy_with_state  = "shallow"
}

dependency "apse1_cloudfront" {
  config_path = "../../region/ap-southeast-1/cloudfront"

  mock_outputs = {
    bucket_ids = {
      run   = "mock-cf-assets-run-apse1"
      auth  = "mock-cf-assets-auth-apse1"
      cms   = "mock-cf-assets-cms-apse1"
      gpx   = "mock-cf-assets-gpx-apse1"
      flash = "mock-cf-assets-flash-apse1"
    }
    bucket_arns = {
      run   = "arn:aws:s3:::mock-cf-assets-run-apse1"
      auth  = "arn:aws:s3:::mock-cf-assets-auth-apse1"
      cms   = "arn:aws:s3:::mock-cf-assets-cms-apse1"
      gpx   = "arn:aws:s3:::mock-cf-assets-gpx-apse1"
      flash = "arn:aws:s3:::mock-cf-assets-flash-apse1"
    }
    bucket_regional_domain_names = {
      run   = "mock-cf-assets-run-apse1.s3.ap-southeast-1.amazonaws.com"
      auth  = "mock-cf-assets-auth-apse1.s3.ap-southeast-1.amazonaws.com"
      cms   = "mock-cf-assets-cms-apse1.s3.ap-southeast-1.amazonaws.com"
      gpx   = "mock-cf-assets-gpx-apse1.s3.ap-southeast-1.amazonaws.com"
      flash = "mock-cf-assets-flash-apse1.s3.ap-southeast-1.amazonaws.com"
    }
    region_label = "apse1"
  }
  mock_outputs_allowed_terraform_commands = ["init", "validate", "plan", "destroy", "apply"]
  mock_outputs_merge_strategy_with_state  = "shallow"
}

# Dependencies on regional network modules for ALB info
dependency "use1_network" {
  config_path = "../../region/us-east-1/network"

  mock_outputs = {
    alb_dns_name = "mock-alb-use1.us-east-1.elb.amazonaws.com"
    alb_zone_id  = "Z35SXDOTRQ7X7K"
  }
  mock_outputs_allowed_terraform_commands = ["init", "validate", "plan", "destroy"]
}

# Dependencies on regional s3-uploads modules for CMS media buckets
dependency "use1_uploads" {
  config_path = "../../region/us-east-1/s3-uploads"

  mock_outputs = {
    bucket_names = {
      "cms-media" = "mock-uploads-cms-media-use1"
    }
    bucket_arns = {
      "cms-media" = "arn:aws:s3:::mock-uploads-cms-media-use1"
    }
    bucket_regional_domain_names = {
      "cms-media" = "mock-uploads-cms-media-use1.s3.us-east-1.amazonaws.com"
    }
  }
  mock_outputs_allowed_terraform_commands = ["init", "validate", "plan", "destroy"]
}

dependency "cac1_network" {
  config_path = "../../region/ca-central-1/network"

  mock_outputs = {
    alb_dns_name = "mock-alb-cac1.ca-central-1.elb.amazonaws.com"
    alb_zone_id  = "ZQSVJUPU6J1EY"
  }
  mock_outputs_allowed_terraform_commands = ["init", "validate", "plan", "destroy", "apply"]
  mock_outputs_merge_strategy_with_state  = "shallow"
}

dependency "apse1_network" {
  config_path = "../../region/ap-southeast-1/network"

  mock_outputs = {
    alb_dns_name = "mock-alb-apse1.ap-southeast-1.elb.amazonaws.com"
    alb_zone_id  = "Z1LMS91P8CMLE5"
  }
  mock_outputs_allowed_terraform_commands = ["init", "validate", "plan", "destroy", "apply"]
  mock_outputs_merge_strategy_with_state  = "shallow"
}

dependency "cac1_uploads" {
  config_path = "../../region/ca-central-1/s3-uploads"

  mock_outputs = {
    bucket_names = {
      "cms-media" = "mock-uploads-cms-media-cac1"
    }
    bucket_arns = {
      "cms-media" = "arn:aws:s3:::mock-uploads-cms-media-cac1"
    }
    bucket_regional_domain_names = {
      "cms-media" = "mock-uploads-cms-media-cac1.s3.ca-central-1.amazonaws.com"
    }
  }
  mock_outputs_allowed_terraform_commands = ["init", "validate", "plan", "destroy", "apply"]
  mock_outputs_merge_strategy_with_state  = "shallow"
}

dependency "apse1_uploads" {
  config_path = "../../region/ap-southeast-1/s3-uploads"

  mock_outputs = {
    bucket_names = {
      "cms-media" = "mock-uploads-cms-media-apse1"
    }
    bucket_arns = {
      "cms-media" = "arn:aws:s3:::mock-uploads-cms-media-apse1"
    }
    bucket_regional_domain_names = {
      "cms-media" = "mock-uploads-cms-media-apse1.s3.ap-southeast-1.amazonaws.com"
    }
  }
  mock_outputs_allowed_terraform_commands = ["init", "validate", "plan", "destroy", "apply"]
  mock_outputs_merge_strategy_with_state  = "shallow"
}

# Dependency on site module for Route53 zone and WAF
dependency "site" {
  config_path = "../.."

  mock_outputs = {
    zone_map = merge(
      {
        (local._zone) = {
          zone_id = "Z1234567890ABC"
          name    = local._zone
        }
      },
      {
        for i, sub in local._subs :
        "${sub}.${local._zone}" => {
          zone_id = format("Z1234567890AB%s", upper(substr("defghijklmnop", i, 1)))
          name    = "${sub}.${local._zone}"
        }
      }
    )
    waf = {
      default = {
        web_acl_arn = "arn:aws:wafv2:us-east-1:123456789012:global/webacl/mock-default/mock-id"
      }
      api = {
        web_acl_arn = "arn:aws:wafv2:us-east-1:123456789012:global/webacl/mock-api/mock-id"
      }
    }
  }
  mock_outputs_allowed_terraform_commands = ["init", "validate", "plan", "destroy"]
}

# Dependency on us-east-1 certs for CloudFront certificate (must be in us-east-1)
dependency "use1_certs" {
  config_path = "../../region/us-east-1/certs"

  mock_outputs = {
    cert_map = {
      for dom in local._cf_doms :
      "${dom}.${local._zone}" => {
        arn = "arn:aws:acm:us-east-1:123456789012:certificate/mock-cert-${dom}-id"
      }
    }
  }
  mock_outputs_allowed_terraform_commands = ["init", "validate", "plan", "destroy"]
}

include "module" {
  path   = "${find_in_parent_folders("modules")}/cloudfront/config.hcl"
  expose = true
}

include "providers" {
  path = "${find_in_parent_folders("providers")}/global.hcl"
}

terraform {
  source = "${include.module.locals.module_path}/v1.0.0"
}

inputs = merge(
  local.site_vars.locals,
  {
    # Build per-domain regional origins by combining domains and regions
    # Structure: regional_origins_by_domain[domain][region] = { alb_*, s3_* }
    regional_origins_by_domain = {
      for domain in local.site_vars.locals.cloudfront.domains : domain => {
        use1 = {
          alb_dns_name                   = try(dependency.use1_network.outputs.alb_dns_name, "")
          alb_zone_id                    = try(dependency.use1_network.outputs.alb_zone_id, "")
          s3_bucket_id                   = dependency.use1_cloudfront.outputs.bucket_ids[domain]
          s3_bucket_arn                  = dependency.use1_cloudfront.outputs.bucket_arns[domain]
          s3_bucket_regional_domain_name = dependency.use1_cloudfront.outputs.bucket_regional_domain_names[domain]
        }
        cac1 = {
          alb_dns_name                   = try(dependency.cac1_network.outputs.alb_dns_name, "")
          alb_zone_id                    = try(dependency.cac1_network.outputs.alb_zone_id, "")
          s3_bucket_id                   = try(dependency.cac1_cloudfront.outputs.bucket_ids[domain], "")
          s3_bucket_arn                  = try(dependency.cac1_cloudfront.outputs.bucket_arns[domain], "")
          s3_bucket_regional_domain_name = try(dependency.cac1_cloudfront.outputs.bucket_regional_domain_names[domain], "")
        }
        apse1 = {
          alb_dns_name                   = try(dependency.apse1_network.outputs.alb_dns_name, "")
          alb_zone_id                    = try(dependency.apse1_network.outputs.alb_zone_id, "")
          s3_bucket_id                   = try(dependency.apse1_cloudfront.outputs.bucket_ids[domain], "")
          s3_bucket_arn                  = try(dependency.apse1_cloudfront.outputs.bucket_arns[domain], "")
          s3_bucket_regional_domain_name = try(dependency.apse1_cloudfront.outputs.bucket_regional_domain_names[domain], "")
        }
      }
    }

    # Route53 zone map for DNS record lookups
    zone_map = dependency.site.outputs.zone_map

    # ACM Certificate map from us-east-1 certs (CloudFront requires cert in us-east-1)
    cert_map = dependency.use1_certs.outputs.cert_map

    # WAF Web ACL ARNs per domain
    # Map domain names to their corresponding WAF ruleset ARNs
    # Based on waf_rulesets configuration in site.hcl
    # Only populate if WAF is enabled in site.hcl
    waf_web_acl_arns = local.site_vars.locals.waf.enabled ? {
      for domain in local.site_vars.locals.cloudfront.domains :
      domain => try(
        dependency.site.outputs.waf[local.site_vars.locals.cloudfront.waf_rulesets[domain]].web_acl_arn,
        ""
      )
    } : {}

    # CMS media bucket origins for /{region}/cms/* behavior
    # This maps the Strapi media uploads to CloudFront via OAC
    cms_media_origins = {
      use1 = {
        s3_bucket_id                   = try(dependency.use1_uploads.outputs.bucket_names["cms-media"], "")
        s3_bucket_arn                  = try(dependency.use1_uploads.outputs.bucket_arns["cms-media"], "")
        s3_bucket_regional_domain_name = try(dependency.use1_uploads.outputs.bucket_regional_domain_names["cms-media"], "")
      }
      cac1 = {
        s3_bucket_id                   = try(dependency.cac1_uploads.outputs.bucket_names["cms-media"], "")
        s3_bucket_arn                  = try(dependency.cac1_uploads.outputs.bucket_arns["cms-media"], "")
        s3_bucket_regional_domain_name = try(dependency.cac1_uploads.outputs.bucket_regional_domain_names["cms-media"], "")
      }
      apse1 = {
        s3_bucket_id                   = try(dependency.apse1_uploads.outputs.bucket_names["cms-media"], "")
        s3_bucket_arn                  = try(dependency.apse1_uploads.outputs.bucket_arns["cms-media"], "")
        s3_bucket_regional_domain_name = try(dependency.apse1_uploads.outputs.bucket_regional_domain_names["cms-media"], "")
      }
    }

    # Tags
    tags = {
      Environment = local.site_vars.locals.site.label
      ManagedBy   = "Terragrunt"
      Purpose     = "CloudFront"
    }
  }
)