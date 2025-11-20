output "distribution_id" {
  description = "ID of the CloudFront distribution"
  value       = aws_cloudfront_distribution.main.id
}

output "distribution_arn" {
  description = "ARN of the CloudFront distribution"
  value       = aws_cloudfront_distribution.main.arn
}

output "distribution_domain_name" {
  description = "Domain name of the CloudFront distribution"
  value       = aws_cloudfront_distribution.main.domain_name
}

output "distribution_hosted_zone_id" {
  description = "CloudFront hosted zone ID for Route53 alias records"
  value       = aws_cloudfront_distribution.main.hosted_zone_id
}

output "logs_bucket_id" {
  description = "ID of the CloudFront logs bucket"
  value       = var.cloudfront.logging.enabled ? aws_s3_bucket.cloudfront_logs[0].id : null
}

output "distribution_url" {
  description = "The domain name corresponding to the distribution"
  value       = "${var.cloudfront.domains[0]}.${var.dns.zonename}"
}
