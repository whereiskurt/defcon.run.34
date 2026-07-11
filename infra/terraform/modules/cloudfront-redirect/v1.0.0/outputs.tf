output "distribution_domains" {
  description = "CloudFront distribution domain names, keyed by host label."
  value       = { for k, d in aws_cloudfront_distribution.redirect : k => d.domain_name }
}

output "redirect_fqdns" {
  description = "FQDNs of the created redirect hosts."
  value       = [for k, rec in aws_route53_record.redirect_alias : rec.fqdn]
}
