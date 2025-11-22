output "buckets" {
  description = "Map of CloudFront assets buckets by domain"
  value = {
    for domain, bucket in aws_s3_bucket.cf_assets : domain => {
      id                       = bucket.id
      arn                      = bucket.arn
      regional_domain_name     = bucket.bucket_regional_domain_name
      domain_name              = bucket.bucket_domain_name
      region_label             = var.region.label
    }
  }
}

output "bucket_ids" {
  description = "Map of bucket IDs by domain"
  value = {
    for domain, bucket in aws_s3_bucket.cf_assets : domain => bucket.id
  }
}

output "bucket_arns" {
  description = "Map of bucket ARNs by domain"
  value = {
    for domain, bucket in aws_s3_bucket.cf_assets : domain => bucket.arn
  }
}

output "bucket_regional_domain_names" {
  description = "Map of bucket regional domain names by domain"
  value = {
    for domain, bucket in aws_s3_bucket.cf_assets : domain => bucket.bucket_regional_domain_name
  }
}

output "region_label" {
  description = "Region label for these buckets"
  value       = var.region.label
}
