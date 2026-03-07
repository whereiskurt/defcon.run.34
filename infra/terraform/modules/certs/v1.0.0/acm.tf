locals {
  zone_records = {
    for zone_name, zone_data in var.zone_map :
    zone_name => {
      zone_id     = zone_data.zone_id
      domain_name = zone_data.name
    }
  }
}

# Create ACM certificate for primary zone with all subdomains as SANs
resource "aws_acm_certificate" "primary_zone_cert" {
  count             = var.make_site_cert ? 1 : 0
  provider          = aws.application
  validation_method = "DNS"
  domain_name       = var.dns.zonename
  # *.defcon.run covers all single-level subdomains, so only add region-specific SANs.
  # ACM default quota is 10 domain names per cert (primary + SANs).
  subject_alternative_names = [
    for subdomain in ["*", var.region.label, "*.${var.region.label}"] :
    "${subdomain}.${var.dns.zonename}"
  ]

  lifecycle {
    create_before_destroy = true
  }
}

# Create ACM certificates for each subdomain
resource "aws_acm_certificate" "subdomain_certs" {
  provider                  = aws.application
  for_each                  = toset(var.dns.subdomains)
  validation_method         = "DNS"
  domain_name               = "${each.key}.${var.dns.zonename}"
  subject_alternative_names = ["*.${each.key}.${var.dns.zonename}"]

  lifecycle {
    create_before_destroy = true
  }
}

# Create Route 53 validation records for primary zone certificate
resource "aws_route53_record" "primary_zone_validation" {
  provider = aws.global-management

  for_each = var.make_site_cert ? {
    for dvo in aws_acm_certificate.primary_zone_cert[0].domain_validation_options :
    dvo.domain_name => {
      name   = dvo.resource_record_name
      type   = dvo.resource_record_type
      record = dvo.resource_record_value
    }
  } : {}

  allow_overwrite = true
  zone_id         = local.zone_records[var.dns.zonename].zone_id
  name            = each.value.name
  type            = each.value.type
  records         = [each.value.record]
  ttl             = 60
}

# Create Route 53 validation records for each subdomain's validation options
resource "aws_route53_record" "validation" {
  provider = aws.application

  for_each = {
    for domain, cert in aws_acm_certificate.subdomain_certs :
    domain => {
      validations = cert.domain_validation_options
      # Use the subdomain's zone if it exists, otherwise use the parent zone
      zone_id = try(
        local.zone_records[cert.domain_name].zone_id,
        local.zone_records[var.dns.zonename].zone_id
      )
    }
  }

  allow_overwrite = true
  zone_id         = each.value.zone_id

  # Use a for loop to extract values from the set
  name    = [for v in each.value.validations : v.resource_record_name][0]
  type    = [for v in each.value.validations : v.resource_record_type][0]
  records = [[for v in each.value.validations : v.resource_record_value][0]]

  ttl = 60
}

# Validate primary zone ACM certificate
resource "aws_acm_certificate_validation" "primary_zone_cert_validation" {
  count           = var.make_site_cert ? 1 : 0
  provider        = aws.application
  certificate_arn = aws_acm_certificate.primary_zone_cert[0].arn

  validation_record_fqdns = [
    for validation in aws_route53_record.primary_zone_validation : validation.fqdn
  ]
}

# Validate subdomain ACM certificates
resource "aws_acm_certificate_validation" "subdomain_cert_validation" {
  provider        = aws.application
  for_each        = toset(var.dns.subdomains)
  certificate_arn = aws_acm_certificate.subdomain_certs[each.key].arn

  validation_record_fqdns = [
    for validation in aws_route53_record.validation : validation.fqdn
  ]
}
