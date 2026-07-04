output "bucket" {
  description = "S3 bucket holding the static site"
  value       = aws_s3_bucket.site.bucket
}

output "distribution_id" {
  description = "CloudFront distribution id"
  value       = aws_cloudfront_distribution.cdn.id
}

output "distribution_domain" {
  description = "CloudFront distribution domain name"
  value       = aws_cloudfront_distribution.cdn.domain_name
}

output "content_prefix" {
  description = "Path prefix under which content is served (e.g. use1)"
  value       = local.prefix
}

output "url" {
  description = "Public URL"
  value       = "https://${local.fqdn}/"
}
