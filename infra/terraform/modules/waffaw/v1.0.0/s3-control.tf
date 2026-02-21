# S3 control plane bucket — sole coordination mechanism for the fleet
resource "aws_s3_bucket" "control" {
  count = var.waffaw.enabled ? 1 : 0

  bucket = "waffaw-control-${data.aws_caller_identity.current.account_id}"

  tags = {
    Name   = "waffaw-control"
    Region = var.region.label
    Site   = var.site.label
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "control" {
  count = var.waffaw.enabled ? 1 : 0

  bucket = aws_s3_bucket.control[0].id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "control" {
  count = var.waffaw.enabled ? 1 : 0

  bucket = aws_s3_bucket.control[0].id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# Lifecycle rules: expire heartbeats, outputs, and consensus artifacts
# Note: S3 lifecycle prefix filters apply to the full key path.
# meta.json has no expiration — nodes deregister on SIGTERM.
resource "aws_s3_bucket_lifecycle_configuration" "control" {
  count = var.waffaw.enabled ? 1 : 0

  bucket = aws_s3_bucket.control[0].id

  # Node outputs expire after 7 days
  rule {
    id     = "expire-node-outputs"
    status = "Enabled"

    filter {
      prefix = "nodes/"
    }

    # Can't filter by suffix in S3 lifecycle, so we expire all nodes/ content
    # after 7 days. Alive nodes re-register meta.json and alive.txt on each
    # heartbeat cycle (every 30s), so active nodes are unaffected.
    # Stale nodes (terminated without cleanup) get cleaned up automatically.
    expiration {
      days = 7
    }
  }

  # Consensus artifacts expire after 1 day (recreated each campaign)
  rule {
    id     = "expire-consensus"
    status = "Enabled"

    filter {
      prefix = "consensus/"
    }

    expiration {
      days = 1
    }
  }

  # Old campaign trigger scripts expire after 3 days
  rule {
    id     = "expire-global-run"
    status = "Enabled"

    filter {
      prefix = "global/run/"
    }

    expiration {
      days = 3
    }
  }
}
