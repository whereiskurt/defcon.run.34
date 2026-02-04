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
