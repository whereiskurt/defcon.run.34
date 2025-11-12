data "aws_caller_identity" "current" { }

# S3 bucket for storing received emails
resource "aws_s3_bucket" "received_emails" {
  bucket   = "ses-inbox-${var.site.label}-${random_id.rnd.hex}"
  force_destroy = true
}

# Enable versioning for the bucket
resource "aws_s3_bucket_versioning" "received_emails" {
  bucket   = aws_s3_bucket.received_emails.id
  versioning_configuration {
    status = "Enabled"
  }
}

# Block public access
resource "aws_s3_bucket_public_access_block" "received_emails" {
  bucket   = aws_s3_bucket.received_emails.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# Lifecycle policy for 90-day retention
resource "aws_s3_bucket_lifecycle_configuration" "received_emails" {
  bucket   = aws_s3_bucket.received_emails.id
  rule {
    id     = "delete-after-90-days"
    status = "Enabled"

    expiration {
      days = 90
    }

    noncurrent_version_expiration {
      noncurrent_days = 90
    }
  }
}

# Server-side encryption
resource "aws_s3_bucket_server_side_encryption_configuration" "received_emails" {
  bucket   = aws_s3_bucket.received_emails.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

# Bucket policy to allow SES to write emails
resource "aws_s3_bucket_policy" "received_emails" {
  bucket   = aws_s3_bucket.received_emails.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "AllowSESPuts"
        Effect = "Allow"
        Principal = {
          Service = "ses.amazonaws.com"
        }
        Action = "s3:PutObject"
        Resource = "${aws_s3_bucket.received_emails.arn}/*"
        Condition = {
          StringEquals = {
            "AWS:SourceAccount" = data.aws_caller_identity.current.account_id
          }
          StringLike = {
            "AWS:SourceArn" = "arn:aws:ses:${var.region.full}:${data.aws_caller_identity.current.account_id}:receipt-rule-set/*"
          }
        }
      }
    ]
  })
}