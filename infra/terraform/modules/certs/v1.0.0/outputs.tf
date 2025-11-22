output "cert_map" {
  value = merge(
    var.make_site_cert ? {
      (aws_acm_certificate.primary_zone_cert[0].domain_name) = {
        arn                       = aws_acm_certificate.primary_zone_cert[0].arn
        domain_name               = aws_acm_certificate.primary_zone_cert[0].domain_name
        subject_alternative_names = aws_acm_certificate.primary_zone_cert[0].subject_alternative_names
        validation_method         = aws_acm_certificate.primary_zone_cert[0].validation_method
      }
    } : {},
    {
      for _, cert in aws_acm_certificate.subdomain_certs :
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
