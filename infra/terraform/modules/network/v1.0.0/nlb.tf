resource "aws_lb" "nlb_public" {
  count                      = var.nlb.enabled ? 1 : 0
  name                       = replace("nlb-${var.region.label}-${var.dns.zonename}", ".", "-")
  internal                   = false
  load_balancer_type         = "network"
  subnets                    = aws_subnet.public_subnet.*.id
  enable_deletion_protection = var.nlb.enable_deletion_protection
  security_groups            = [aws_security_group.nlb.id]

  access_logs {
    bucket  = aws_s3_bucket.nlb_logs[0].id
    enabled = true
  }

  tags = merge(
    var.vpc.tags,
    {
      Name = "${var.region.label}.${var.dns.zonename}-nlb"
    }
  )
}

# S3 bucket for NLB logs
resource "aws_s3_bucket" "nlb_logs" {
  count         = var.nlb.enabled ? 1 : 0
  bucket        = "logs-nlb-${replace(var.region.label, ".", "-")}-${replace(var.dns.zonename, ".", "-")}-${var.site.random_suffix}"
  force_destroy = var.nlb.logs_force_destroy

  tags = merge(
    var.vpc.tags,
    {
      Name = "${var.region.label}.${var.dns.zonename}-nlb-logs"
    }
  )
}

resource "aws_s3_bucket_ownership_controls" "nlb_logs" {
  count  = var.nlb.enabled ? 1 : 0
  bucket = aws_s3_bucket.nlb_logs[0].id

  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_policy" "nlb_logs_policy" {
  count  = var.nlb.enabled ? 1 : 0
  bucket = aws_s3_bucket.nlb_logs[0].id

  policy = jsonencode({
    Version = "2012-10-17",
    Statement = [
      {
        Effect = "Allow",
        Principal = {
          Service = "delivery.logs.amazonaws.com"
        },
        Action   = "s3:PutObject",
        Resource = "${aws_s3_bucket.nlb_logs[0].arn}/*",
        Condition = {
          StringEquals = {
            "s3:x-amz-acl" = "bucket-owner-full-control"
          }
        }
      },
      {
        Effect = "Allow",
        Principal = {
          Service = "delivery.logs.amazonaws.com"
        },
        Action   = "s3:GetBucketAcl",
        Resource = aws_s3_bucket.nlb_logs[0].arn
      }
    ]
  })
}
