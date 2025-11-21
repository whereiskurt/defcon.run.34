# Dependencies on regional cloudfront-assets modules
dependency "use1_cloudfront" {
  config_path = "../region/us-east-1/cloudfront"

  mock_outputs = {
    bucket_ids = {
      run  = "mock-cf-assets-run-use1"
      mqtt = "mock-cf-assets-mqtt-use1"
    }
    bucket_arns = {
      run  = "arn:aws:s3:::mock-cf-assets-run-use1"
      mqtt = "arn:aws:s3:::mock-cf-assets-mqtt-use1"
    }
    bucket_regional_domain_names = {
      run  = "mock-cf-assets-run-use1.s3.us-east-1.amazonaws.com"
      mqtt = "mock-cf-assets-mqtt-use1.s3.us-east-1.amazonaws.com"
    }
    region_label = "use1"
  }
  mock_outputs_allowed_terraform_commands = ["init", "validate", "plan", "destroy"]
}

dependency "cac1_cloudfront" {
  config_path = "../region/ca-central-1/cloudfront"

  mock_outputs = {
    bucket_ids = {
      run  = "mock-cf-assets-run-cac1"
      mqtt = "mock-cf-assets-mqtt-cac1"
    }
    bucket_arns = {
      run  = "arn:aws:s3:::mock-cf-assets-run-cac1"
      mqtt = "arn:aws:s3:::mock-cf-assets-mqtt-cac1"
    }
    bucket_regional_domain_names = {
      run  = "mock-cf-assets-run-cac1.s3.ca-central-1.amazonaws.com"
      mqtt = "mock-cf-assets-mqtt-cac1.s3.ca-central-1.amazonaws.com"
    }
    region_label = "cac1"
  }
  mock_outputs_allowed_terraform_commands = ["init", "validate", "plan", "destroy"]
}

# Dependencies on regional network modules for ALB info
dependency "use1_network" {
  config_path = "../region/us-east-1/network"

  mock_outputs = {
    alb_dns_name = "mock-alb-use1.us-east-1.elb.amazonaws.com"
    alb_zone_id  = "Z35SXDOTRQ7X7K"
  }
  mock_outputs_allowed_terraform_commands = ["init", "validate", "plan", "destroy"]
}

dependency "cac1_network" {
  config_path = "../region/ca-central-1/network"

  mock_outputs = {
    alb_dns_name = "mock-alb-cac1.ca-central-1.elb.amazonaws.com"
    alb_zone_id  = "ZQSVJUPU6J1EY"
  }
  mock_outputs_allowed_terraform_commands = ["init", "validate", "plan", "destroy"]
}

# Dependency on site module for Route53 zone
dependency "site" {
  config_path = ".."

  mock_outputs = {
    zone_map = {
      "defcon.run" = {
        zone_id = "Z1234567890ABC"
        name    = "defcon.run"
      }
    }
  }
  mock_outputs_allowed_terraform_commands = ["init", "validate", "plan", "destroy"]
}

# Dependency on us-east-1 certs for CloudFront certificate (must be in us-east-1)
dependency "use1_certs" {
  config_path = "../region/us-east-1/certs"

  mock_outputs = {
    cert_map = {
      "run.defcon.run" = {
        arn = "arn:aws:acm:us-east-1:123456789012:certificate/mock-cert-id"
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

locals {
  site_vars = read_terragrunt_config(find_in_parent_folders("site.hcl"))
}

inputs = merge(
  local.site_vars.locals,
  {
    # Build per-domain regional origins by combining domains and regions
    # Structure: regional_origins_by_domain[domain][region] = { alb_*, s3_* }
    regional_origins_by_domain = {
      for domain in local.site_vars.locals.cloudfront.domains : domain => {
        use1 = {
          alb_dns_name                   = dependency.use1_network.outputs.alb_dns_name
          alb_zone_id                    = dependency.use1_network.outputs.alb_zone_id
          s3_bucket_id                   = dependency.use1_cloudfront.outputs.bucket_ids[domain]
          s3_bucket_arn                  = dependency.use1_cloudfront.outputs.bucket_arns[domain]
          s3_bucket_regional_domain_name = dependency.use1_cloudfront.outputs.bucket_regional_domain_names[domain]
        }
        cac1 = {
          alb_dns_name                   = dependency.cac1_network.outputs.alb_dns_name
          alb_zone_id                    = dependency.cac1_network.outputs.alb_zone_id
          s3_bucket_id                   = dependency.cac1_cloudfront.outputs.bucket_ids[domain]
          s3_bucket_arn                  = dependency.cac1_cloudfront.outputs.bucket_arns[domain]
          s3_bucket_regional_domain_name = dependency.cac1_cloudfront.outputs.bucket_regional_domain_names[domain]
        }
      }
    }

    # Route53 zone map for DNS record lookups
    zone_map = dependency.site.outputs.zone_map

    # ACM Certificate map from us-east-1 certs (CloudFront requires cert in us-east-1)
    cert_map = dependency.use1_certs.outputs.cert_map

    # Optional WAF Web ACL ARN (empty string if WAF not enabled)
    waf_web_acl_arn = ""

    # Tags
    tags = {
      Environment = local.site_vars.locals.site.label
      ManagedBy   = "Terragrunt"
      Purpose     = "CloudFront"
    }
  }
)