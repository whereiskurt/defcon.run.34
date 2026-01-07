output "distributions" {
  description = "Map of CloudFront distributions by domain"
  value = {
    for domain, dist in aws_cloudfront_distribution.main : domain => {
      id             = dist.id
      arn            = dist.arn
      domain_name    = dist.domain_name
      hosted_zone_id = dist.hosted_zone_id
      url            = "${domain}.${var.dns.zonename}"
    }
  }
}

output "distribution_ids" {
  description = "Map of CloudFront distribution IDs by domain"
  value = {
    for domain, dist in aws_cloudfront_distribution.main : domain => dist.id
  }
}

output "distribution_arns" {
  description = "Map of CloudFront distribution ARNs by domain"
  value = {
    for domain, dist in aws_cloudfront_distribution.main : domain => dist.arn
  }
}

output "distribution_domain_names" {
  description = "Map of CloudFront distribution domain names by domain"
  value = {
    for domain, dist in aws_cloudfront_distribution.main : domain => dist.domain_name
  }
}

output "logs_bucket_ids" {
  description = "Map of CloudFront logs bucket IDs by domain"
  value = var.cloudfront.logging.enabled ? {
    for domain, bucket in aws_s3_bucket.cloudfront_logs : domain => bucket.id
  } : {}
}

output "distribution_urls" {
  description = "Map of CloudFront distribution URLs by domain"
  value = {
    for domain in var.cloudfront.domains : domain => "${domain}.${var.dns.zonename}"
  }
}
