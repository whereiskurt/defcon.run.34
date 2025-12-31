# Bucket information
output "buckets" {
  description = "Map of upload bucket details by name"
  value = {
    for name, bucket in aws_s3_bucket.uploads : name => {
      name   = bucket.id
      arn    = bucket.arn
      region = var.region.full
    }
  }
}

output "bucket_names" {
  description = "Map of bucket names by upload name"
  value = {
    for name, bucket in aws_s3_bucket.uploads : name => bucket.id
  }
}

output "bucket_arns" {
  description = "Map of bucket ARNs by upload name"
  value = {
    for name, bucket in aws_s3_bucket.uploads : name => bucket.arn
  }
}

output "bucket_regional_domain_names" {
  description = "Map of bucket regional domain names by upload name (for CloudFront origins)"
  value = {
    for name, bucket in aws_s3_bucket.uploads : name => bucket.bucket_regional_domain_name
  }
}

# Presigner credentials (sensitive)
output "presigner_credentials" {
  description = "Presigner IAM user credentials (sensitive)"
  sensitive   = true
  value = {
    for name, key in aws_iam_access_key.presigner : name => {
      access_key_id     = key.id
      secret_access_key = key.secret
      user_name         = aws_iam_user.presigner[name].name
    }
  }
}

# SSM parameter paths for container secrets
output "ssm_paths" {
  description = "SSM parameter paths for each upload configuration"
  value = {
    for name, _ in local.uploads_map : name => {
      access_key_id     = aws_ssm_parameter.access_key_id[name].name
      secret_access_key = aws_ssm_parameter.secret_access_key[name].name
      bucket_name       = aws_ssm_parameter.bucket_name[name].name
      bucket_arn        = aws_ssm_parameter.bucket_arn[name].name
      bucket_region     = aws_ssm_parameter.bucket_region[name].name
    }
  }
}

# SSM parameter ARNs for IAM policies
output "ssm_arns" {
  description = "SSM parameter ARNs for each upload configuration"
  value = {
    for name, _ in local.uploads_map : name => {
      access_key_id     = aws_ssm_parameter.access_key_id[name].arn
      secret_access_key = aws_ssm_parameter.secret_access_key[name].arn
      bucket_name       = aws_ssm_parameter.bucket_name[name].arn
      bucket_arn        = aws_ssm_parameter.bucket_arn[name].arn
      bucket_region     = aws_ssm_parameter.bucket_region[name].arn
    }
  }
}

# Replication status
output "replication_enabled" {
  description = "Map indicating if replication is enabled for each upload"
  value = {
    for name, config in local.replication_config : name => config.enabled
  }
}

# Upload names for this region
output "upload_names" {
  description = "List of upload configuration names in this region"
  value       = keys(local.uploads_map)
}
