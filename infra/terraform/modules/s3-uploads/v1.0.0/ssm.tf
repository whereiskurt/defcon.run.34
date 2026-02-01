# SSM Parameters for presigner credentials and bucket info
# Following the pattern from dynamodb and email modules
# String parameters store non-sensitive metadata (bucket names, ARNs, regions)
# SecureString parameters (access keys) use KMS encryption via kms.tf

# Access Key ID
resource "aws_ssm_parameter" "access_key_id" {
  for_each = local.uploads_map

  name        = "/${var.site.label}/uploads/${var.region.label}/${each.key}/access_key_id"
  description = "S3 presigner access key ID for ${each.key} in ${var.region.label}"
  type        = "SecureString"
  value       = aws_iam_access_key.presigner[each.key].id
  key_id      = aws_kms_key.ssm.arn

  tags = {
    Name    = "uploads-${each.key}-access-key-id"
    Service = each.value.service_name
    Region  = var.region.label
    Site    = var.site.label
  }
}

# Secret Access Key
resource "aws_ssm_parameter" "secret_access_key" {
  for_each = local.uploads_map

  name        = "/${var.site.label}/uploads/${var.region.label}/${each.key}/secret_access_key"
  description = "S3 presigner secret access key for ${each.key} in ${var.region.label}"
  type        = "SecureString"
  value       = aws_iam_access_key.presigner[each.key].secret
  key_id      = aws_kms_key.ssm.arn

  tags = {
    Name    = "uploads-${each.key}-secret-access-key"
    Service = each.value.service_name
    Region  = var.region.label
    Site    = var.site.label
  }
}

# Bucket Name
#checkov:skip=CKV2_AWS_34:Bucket names are non-sensitive infrastructure metadata
resource "aws_ssm_parameter" "bucket_name" {
  for_each = local.uploads_map

  name        = "/${var.site.label}/uploads/${var.region.label}/${each.key}/bucket_name"
  description = "S3 bucket name for ${each.key} uploads in ${var.region.label}"
  type        = "String"
  value       = aws_s3_bucket.uploads[each.key].id

  tags = {
    Name    = "uploads-${each.key}-bucket-name"
    Service = each.value.service_name
    Region  = var.region.label
    Site    = var.site.label
  }
}

# Bucket ARN
#checkov:skip=CKV2_AWS_34:Bucket ARNs are non-sensitive infrastructure metadata
resource "aws_ssm_parameter" "bucket_arn" {
  for_each = local.uploads_map

  name        = "/${var.site.label}/uploads/${var.region.label}/${each.key}/bucket_arn"
  description = "S3 bucket ARN for ${each.key} uploads in ${var.region.label}"
  type        = "String"
  value       = aws_s3_bucket.uploads[each.key].arn

  tags = {
    Name    = "uploads-${each.key}-bucket-arn"
    Service = each.value.service_name
    Region  = var.region.label
    Site    = var.site.label
  }
}

# Bucket Region
#checkov:skip=CKV2_AWS_34:Region names are non-sensitive infrastructure metadata
resource "aws_ssm_parameter" "bucket_region" {
  for_each = local.uploads_map

  name        = "/${var.site.label}/uploads/${var.region.label}/${each.key}/bucket_region"
  description = "S3 bucket region for ${each.key} uploads"
  type        = "String"
  value       = var.region.full

  tags = {
    Name    = "uploads-${each.key}-bucket-region"
    Service = each.value.service_name
    Region  = var.region.label
    Site    = var.site.label
  }
}
