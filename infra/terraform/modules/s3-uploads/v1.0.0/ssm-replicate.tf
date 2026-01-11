# Cross-region SSM parameter replication
# Replicates bucket credentials to other regions for services that need cross-region access
# (e.g., Litestream workers in ca-central-1 accessing master bucket in us-east-1)

# Build a map of all SSM replication targets
# Format: { "cms-litestream:cac1" = { upload_name = "cms-litestream", region = { label = "cac1", full = "ca-central-1" } } }
locals {
  ssm_replicate_targets = merge([
    for name, upload in local.uploads_map : {
      for region in try(upload.ssm_replicate_to, []) :
      "${name}:${region.label}" => {
        upload_name  = name
        upload       = upload
        region_label = region.label
        region_full  = region.full
      }
      if !contains(var.site.skip_regions, region.full)
    }
  ]...)
}

# Provider aliases for cross-region SSM replication
# We use aws_ssm_parameter with explicit provider configuration

# ca-central-1 provider for SSM replication
provider "aws" {
  alias  = "cac1"
  region = "ca-central-1"
}

# us-east-1 provider for SSM replication (in case source is cac1)
provider "aws" {
  alias  = "use1"
  region = "us-east-1"
}

# Replicated Access Key ID to ca-central-1
resource "aws_ssm_parameter" "replicate_access_key_id_cac1" {
  for_each = {
    for k, v in local.ssm_replicate_targets : k => v
    if v.region_full == "ca-central-1"
  }
  provider = aws.cac1

  name        = "/${var.site.label}/uploads/${each.value.region_label}/${each.value.upload_name}/access_key_id"
  description = "S3 presigner access key ID for ${each.value.upload_name} (replicated from ${var.region.label})"
  type        = "SecureString"
  value       = aws_iam_access_key.presigner[each.value.upload_name].id

  tags = {
    Name           = "uploads-${each.value.upload_name}-access-key-id"
    Service        = each.value.upload.service_name
    Region         = each.value.region_label
    Site           = var.site.label
    ReplicatedFrom = var.region.label
  }
}

# Replicated Secret Access Key to ca-central-1
resource "aws_ssm_parameter" "replicate_secret_access_key_cac1" {
  for_each = {
    for k, v in local.ssm_replicate_targets : k => v
    if v.region_full == "ca-central-1"
  }
  provider = aws.cac1

  name        = "/${var.site.label}/uploads/${each.value.region_label}/${each.value.upload_name}/secret_access_key"
  description = "S3 presigner secret access key for ${each.value.upload_name} (replicated from ${var.region.label})"
  type        = "SecureString"
  value       = aws_iam_access_key.presigner[each.value.upload_name].secret

  tags = {
    Name           = "uploads-${each.value.upload_name}-secret-access-key"
    Service        = each.value.upload.service_name
    Region         = each.value.region_label
    Site           = var.site.label
    ReplicatedFrom = var.region.label
  }
}

# Replicated Bucket Name to ca-central-1
resource "aws_ssm_parameter" "replicate_bucket_name_cac1" {
  for_each = {
    for k, v in local.ssm_replicate_targets : k => v
    if v.region_full == "ca-central-1"
  }
  provider = aws.cac1

  name        = "/${var.site.label}/uploads/${each.value.region_label}/${each.value.upload_name}/bucket_name"
  description = "S3 bucket name for ${each.value.upload_name} (replicated from ${var.region.label})"
  type        = "String"
  value       = aws_s3_bucket.uploads[each.value.upload_name].id

  tags = {
    Name           = "uploads-${each.value.upload_name}-bucket-name"
    Service        = each.value.upload.service_name
    Region         = each.value.region_label
    Site           = var.site.label
    ReplicatedFrom = var.region.label
  }
}

# Replicated Bucket ARN to ca-central-1
resource "aws_ssm_parameter" "replicate_bucket_arn_cac1" {
  for_each = {
    for k, v in local.ssm_replicate_targets : k => v
    if v.region_full == "ca-central-1"
  }
  provider = aws.cac1

  name        = "/${var.site.label}/uploads/${each.value.region_label}/${each.value.upload_name}/bucket_arn"
  description = "S3 bucket ARN for ${each.value.upload_name} (replicated from ${var.region.label})"
  type        = "String"
  value       = aws_s3_bucket.uploads[each.value.upload_name].arn

  tags = {
    Name           = "uploads-${each.value.upload_name}-bucket-arn"
    Service        = each.value.upload.service_name
    Region         = each.value.region_label
    Site           = var.site.label
    ReplicatedFrom = var.region.label
  }
}

# Replicated Bucket Region to ca-central-1 (stores the SOURCE region, not target)
resource "aws_ssm_parameter" "replicate_bucket_region_cac1" {
  for_each = {
    for k, v in local.ssm_replicate_targets : k => v
    if v.region_full == "ca-central-1"
  }
  provider = aws.cac1

  name        = "/${var.site.label}/uploads/${each.value.region_label}/${each.value.upload_name}/bucket_region"
  description = "S3 bucket region for ${each.value.upload_name} (replicated from ${var.region.label})"
  type        = "String"
  # Important: This is the SOURCE bucket's region, not the target region
  value       = var.region.full

  tags = {
    Name           = "uploads-${each.value.upload_name}-bucket-region"
    Service        = each.value.upload.service_name
    Region         = each.value.region_label
    Site           = var.site.label
    ReplicatedFrom = var.region.label
  }
}

# Replicated Access Key ID to us-east-1
resource "aws_ssm_parameter" "replicate_access_key_id_use1" {
  for_each = {
    for k, v in local.ssm_replicate_targets : k => v
    if v.region_full == "us-east-1"
  }
  provider = aws.use1

  name        = "/${var.site.label}/uploads/${each.value.region_label}/${each.value.upload_name}/access_key_id"
  description = "S3 presigner access key ID for ${each.value.upload_name} (replicated from ${var.region.label})"
  type        = "SecureString"
  value       = aws_iam_access_key.presigner[each.value.upload_name].id

  tags = {
    Name           = "uploads-${each.value.upload_name}-access-key-id"
    Service        = each.value.upload.service_name
    Region         = each.value.region_label
    Site           = var.site.label
    ReplicatedFrom = var.region.label
  }
}

# Replicated Secret Access Key to us-east-1
resource "aws_ssm_parameter" "replicate_secret_access_key_use1" {
  for_each = {
    for k, v in local.ssm_replicate_targets : k => v
    if v.region_full == "us-east-1"
  }
  provider = aws.use1

  name        = "/${var.site.label}/uploads/${each.value.region_label}/${each.value.upload_name}/secret_access_key"
  description = "S3 presigner secret access key for ${each.value.upload_name} (replicated from ${var.region.label})"
  type        = "SecureString"
  value       = aws_iam_access_key.presigner[each.value.upload_name].secret

  tags = {
    Name           = "uploads-${each.value.upload_name}-secret-access-key"
    Service        = each.value.upload.service_name
    Region         = each.value.region_label
    Site           = var.site.label
    ReplicatedFrom = var.region.label
  }
}

# Replicated Bucket Name to us-east-1
resource "aws_ssm_parameter" "replicate_bucket_name_use1" {
  for_each = {
    for k, v in local.ssm_replicate_targets : k => v
    if v.region_full == "us-east-1"
  }
  provider = aws.use1

  name        = "/${var.site.label}/uploads/${each.value.region_label}/${each.value.upload_name}/bucket_name"
  description = "S3 bucket name for ${each.value.upload_name} (replicated from ${var.region.label})"
  type        = "String"
  value       = aws_s3_bucket.uploads[each.value.upload_name].id

  tags = {
    Name           = "uploads-${each.value.upload_name}-bucket-name"
    Service        = each.value.upload.service_name
    Region         = each.value.region_label
    Site           = var.site.label
    ReplicatedFrom = var.region.label
  }
}

# Replicated Bucket ARN to us-east-1
resource "aws_ssm_parameter" "replicate_bucket_arn_use1" {
  for_each = {
    for k, v in local.ssm_replicate_targets : k => v
    if v.region_full == "us-east-1"
  }
  provider = aws.use1

  name        = "/${var.site.label}/uploads/${each.value.region_label}/${each.value.upload_name}/bucket_arn"
  description = "S3 bucket ARN for ${each.value.upload_name} (replicated from ${var.region.label})"
  type        = "String"
  value       = aws_s3_bucket.uploads[each.value.upload_name].arn

  tags = {
    Name           = "uploads-${each.value.upload_name}-bucket-arn"
    Service        = each.value.upload.service_name
    Region         = each.value.region_label
    Site           = var.site.label
    ReplicatedFrom = var.region.label
  }
}

# Replicated Bucket Region to us-east-1 (stores the SOURCE region, not target)
resource "aws_ssm_parameter" "replicate_bucket_region_use1" {
  for_each = {
    for k, v in local.ssm_replicate_targets : k => v
    if v.region_full == "us-east-1"
  }
  provider = aws.use1

  name        = "/${var.site.label}/uploads/${each.value.region_label}/${each.value.upload_name}/bucket_region"
  description = "S3 bucket region for ${each.value.upload_name} (replicated from ${var.region.label})"
  type        = "String"
  # Important: This is the SOURCE bucket's region, not the target region
  value       = var.region.full

  tags = {
    Name           = "uploads-${each.value.upload_name}-bucket-region"
    Service        = each.value.upload.service_name
    Region         = each.value.region_label
    Site           = var.site.label
    ReplicatedFrom = var.region.label
  }
}
