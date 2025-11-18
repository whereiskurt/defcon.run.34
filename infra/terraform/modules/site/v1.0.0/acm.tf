locals {
  zone_records = {
    for zone in flatten([
      for k, v in aws_route53_zone.account_zonenames : [
        {
          key         = v.name
          zone_id     = v.zone_id
          domain_name = v.name
        }
      ]
    ]) :
    zone.domain_name => {
      zone_id     = zone.zone_id
      domain_name = zone.domain_name
    }
  }
}

# Create ACM certificate for primary zone with all subdomains as SANs
resource "aws_acm_certificate" "primary_zone_cert" {
  provider          = aws.global-application
  validation_method = "DNS"
  domain_name       = var.dns.zonename
  subject_alternative_names = [
    for subdomain in var.dns.subdomains :
    "${subdomain}.${var.dns.zonename}"
  ]
}

# Create ACM certificates for each domain in var.domains
resource "aws_acm_certificate" "env_certs" {
  provider                  = aws.global-application
  for_each                  = toset(var.dns.subdomains)
  validation_method         = "DNS"
  domain_name               = "${each.key}.${var.dns.zonename}"
  subject_alternative_names = ["*.${each.key}.${var.dns.zonename}"]
}

# Create Route 53 validation records for primary zone certificate
resource "aws_route53_record" "primary_zone_validation" {
  provider = aws.global-management

  for_each = {
    for dvo in aws_acm_certificate.primary_zone_cert.domain_validation_options :
    dvo.domain_name => {
      name   = dvo.resource_record_name
      type   = dvo.resource_record_type
      record = dvo.resource_record_value
    }
  }

  zone_id = data.aws_route53_zone.mgmt.zone_id
  name    = each.value.name
  type    = each.value.type
  records = [each.value.record]
  ttl     = 60
}

# Create Route 53 validation records for each domain's validation options
resource "aws_route53_record" "validation" {
  provider = aws.global-application

  for_each = {
    for domain, cert in aws_acm_certificate.env_certs :
    domain => {
      validations = cert.domain_validation_options
      zone_id     = local.zone_records[cert.domain_name].zone_id
    }
  }

  zone_id = each.value.zone_id

  # Use a for loop to extract values from the set
  name    = [for v in each.value.validations : v.resource_record_name][0]
  type    = [for v in each.value.validations : v.resource_record_type][0]
  records = [[for v in each.value.validations : v.resource_record_value][0]]

  ttl = 60
}

# Validate primary zone ACM certificate
resource "aws_acm_certificate_validation" "primary_zone_cert_validation" {
  provider        = aws.global-application
  certificate_arn = aws_acm_certificate.primary_zone_cert.arn

  validation_record_fqdns = [
    for validation in aws_route53_record.primary_zone_validation : validation.fqdn
  ]
}

# Validate ACM certificates
resource "aws_acm_certificate_validation" "env_cert_validation" {
  provider        = aws.global-application
  for_each        = toset(var.dns.subdomains)
  certificate_arn = aws_acm_certificate.env_certs[each.key].arn

  validation_record_fqdns = [
    for validation in aws_route53_record.validation : validation.fqdn
  ]
}