output "zone_map" {
  value = merge(
    {
      for _, v in aws_route53_zone.account_zonenames :
      v.name => { "zone_id" : v.zone_id, "name" : v.name, "name_servers" : v.name_servers }
    },
    {
      (data.aws_route53_zone.mgmt.name) = {
        "zone_id" : data.aws_route53_zone.mgmt.zone_id,
        "name" : data.aws_route53_zone.mgmt.name,
        "name_servers" : data.aws_route53_zone.mgmt.name_servers
      }
    }
  )
  sensitive = false
}

output "global_waf_webacl_arn" {
  value     = var.waf.enabled ? "aws_wafv2_web_acl.this[0].arn" : null
  sensitive = false
}

output "cert_map" {
  value = merge(
    {
      (aws_acm_certificate.primary_zone_cert.domain_name) = {
        arn                       = aws_acm_certificate.primary_zone_cert.arn
        domain_name               = aws_acm_certificate.primary_zone_cert.domain_name
        subject_alternative_names = aws_acm_certificate.primary_zone_cert.subject_alternative_names
        validation_method         = aws_acm_certificate.primary_zone_cert.validation_method
      }
    },
    {
      for _, cert in aws_acm_certificate.env_certs :
      cert.domain_name => {
        arn                       = cert.arn
        domain_name               = cert.domain_name
        subject_alternative_names = cert.subject_alternative_names
        validation_method         = cert.validation_method
      }
    }
  )
  sensitive = false
}
