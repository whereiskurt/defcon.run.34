data "aws_caller_identity" "current" {}
data "aws_region" "current" {}

resource "random_id" "rnd" {
  byte_length = 8
}

# S3 bucket for CloudFront assets
resource "aws_s3_bucket" "cf_assets" {
  bucket        = "cf-assets-${var.region.label}-${replace(var.dns.zonename, ".", "-")}-${random_id.rnd.hex}"
  force_destroy = var.force_destroy

  tags = merge(
    var.tags,
    {
      Name        = "${var.region.label}-cf-assets"
      Region      = var.region.full
      Purpose     = "CloudFront Assets"
      Environment = var.site.label
    }
  )
}

# Enable versioning for the assets bucket
resource "aws_s3_bucket_versioning" "cf_assets_versioning" {
  bucket = aws_s3_bucket.cf_assets.id
  versioning_configuration {
    status = var.enable_versioning ? "Enabled" : "Suspended"
  }
}

# Server-side encryption
resource "aws_s3_bucket_server_side_encryption_configuration" "cf_assets_encryption" {
  bucket = aws_s3_bucket.cf_assets.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

# Block public access
resource "aws_s3_bucket_public_access_block" "cf_assets_public_access_block" {
  bucket = aws_s3_bucket.cf_assets.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# CORS configuration for CloudFront
resource "aws_s3_bucket_cors_configuration" "cf_assets_cors" {
  bucket = aws_s3_bucket.cf_assets.id

  cors_rule {
    allowed_headers = ["*"]
    allowed_methods = ["GET", "HEAD"]
    allowed_origins = var.cors_allowed_origins
    expose_headers  = ["ETag"]
    max_age_seconds = 3000
  }
}

# Lifecycle rules for asset management
resource "aws_s3_bucket_lifecycle_configuration" "cf_assets_lifecycle" {
  count  = var.enable_lifecycle_rules ? 1 : 0
  bucket = aws_s3_bucket.cf_assets.id

  rule {
    id     = "delete-old-versions"
    status = "Enabled"

    noncurrent_version_expiration {
      noncurrent_days = 90
    }
  }

  rule {
    id     = "abort-incomplete-multipart-uploads"
    status = "Enabled"

    abort_incomplete_multipart_upload {
      days_after_initiation = 7
    }
  }
}

# S3 bucket policy to allow CloudFront access (only created if CloudFront ARN is provided)
resource "aws_s3_bucket_policy" "cf_access" {
  count  = var.cloudfront_distribution_arn != "" ? 1 : 0
  bucket = aws_s3_bucket.cf_assets.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "AllowCloudFrontServicePrincipal"
        Effect = "Allow"
        Principal = {
          Service = "cloudfront.amazonaws.com"
        }
        Action   = "s3:GetObject"
        Resource = "${aws_s3_bucket.cf_assets.arn}/*"
        Condition = {
          StringEquals = {
            "AWS:SourceArn" = var.cloudfront_distribution_arn
          }
        }
      }
    ]
  })
}
