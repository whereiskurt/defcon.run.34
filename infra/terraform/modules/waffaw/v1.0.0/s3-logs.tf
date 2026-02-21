# S3 logs bucket — Firehose destination, Athena source
resource "aws_s3_bucket" "logs" {
  count = var.waffaw.enabled ? 1 : 0

  bucket = "waffaw-logs-${data.aws_caller_identity.current.account_id}"

  tags = {
    Name   = "waffaw-logs"
    Region = var.region.label
    Site   = var.site.label
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "logs" {
  count = var.waffaw.enabled ? 1 : 0

  bucket = aws_s3_bucket.logs[0].id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "logs" {
  count = var.waffaw.enabled ? 1 : 0

  bucket = aws_s3_bucket.logs[0].id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# Lifecycle: Glacier after 30 days, expire after 90 days
resource "aws_s3_bucket_lifecycle_configuration" "logs" {
  count = var.waffaw.enabled ? 1 : 0

  bucket = aws_s3_bucket.logs[0].id

  rule {
    id     = "archive-and-expire"
    status = "Enabled"

    filter {}

    transition {
      days          = 30
      storage_class = "GLACIER"
    }

    expiration {
      days = 90
    }
  }
}
