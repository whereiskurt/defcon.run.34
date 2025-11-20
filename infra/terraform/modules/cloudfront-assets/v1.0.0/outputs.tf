output "bucket_id" {
  description = "ID of the CloudFront assets bucket"
  value       = aws_s3_bucket.cf_assets.id
}

output "bucket_arn" {
  description = "ARN of the CloudFront assets bucket"
  value       = aws_s3_bucket.cf_assets.arn
}

output "bucket_regional_domain_name" {
  description = "Regional domain name of the bucket"
  value       = aws_s3_bucket.cf_assets.bucket_regional_domain_name
}

output "bucket_domain_name" {
  description = "Domain name of the bucket"
  value       = aws_s3_bucket.cf_assets.bucket_domain_name
}

output "region_label" {
  description = "Region label for this bucket"
  value       = var.region.label
}
