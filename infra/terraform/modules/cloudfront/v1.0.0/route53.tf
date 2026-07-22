# Local to build full domain names and lookup zones
locals {
  # Build full domain names for all CloudFront domains
  full_domains = [for domain in var.cloudfront.domains : "${domain}.${var.dns.zonename}"]

  # Create a map of full domain name to zone_id by looking up the parent zone
  # e.g., for "run.<domain>", look up zone for "<domain>"
  domain_zones = {
    for domain in local.full_domains : domain => var.zone_map[domain].zone_id
  }

  # Create a map of subdomain to full domain for easier lookups
  subdomain_to_full = {
    for domain in var.cloudfront.domains : domain => "${domain}.${var.dns.zonename}"
  }
}

# Route53 A records (aliases) pointing to CloudFront distribution
# Creates one A record for each domain, pointing to its specific distribution
resource "aws_route53_record" "cloudfront_alias" {
  for_each = local.domain_zones

  zone_id = each.value
  name    = each.key
  type    = "A"

  alias {
    name                   = aws_cloudfront_distribution.main[split(".", each.key)[0]].domain_name
    zone_id                = aws_cloudfront_distribution.main[split(".", each.key)[0]].hosted_zone_id
    evaluate_target_health = false
  }

  provider = aws.global-application
}

# Stable origin alias records: origin-<region>.<zonename> -> that region's ALB.
# External systems (Impart gateway upstreams) point at these instead of the raw
# ALB DNS name, so an ALB rebuild (whose DNS suffix changes) requires no
# external reconfiguration. Records live in the APEX zone, which is hosted in
# the management account — hence the aws.global-management provider, the same
# one the site module uses for its NS-forwarding records.
# ALB info is identical across domains; read it from the first domain and skip
# empty/mock placeholders (cac1/apse1 are mocks today).
locals {
  origin_alias_albs = {
    for region_label, origin in var.regional_origins_by_domain[var.cloudfront.domains[0]] :
    region_label => {
      alb_dns_name = origin.alb_dns_name
      alb_zone_id  = origin.alb_zone_id
    }
    if origin.alb_dns_name != "" && !startswith(origin.alb_dns_name, "mock-")
  }
}

resource "aws_route53_record" "origin_alias" {
  for_each = local.origin_alias_albs

  zone_id = var.zone_map[var.dns.zonename].zone_id
  name    = "origin-${each.key}.${var.dns.zonename}"
  type    = "A"

  alias {
    name                   = each.value.alb_dns_name
    zone_id                = each.value.alb_zone_id
    evaluate_target_health = false
  }

  provider = aws.global-management
}
