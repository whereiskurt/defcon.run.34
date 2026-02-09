resource "aws_lb" "lb_public" {
  count                      = var.alb.enabled ? 1 : 0
  name                       = replace("alb-${var.region.label}-${var.dns.zonename}", ".", "-")
  internal                   = false
  load_balancer_type         = "application"
  security_groups            = [aws_security_group.sshhttps.id, aws_security_group.http_only.id]
  subnets                    = aws_subnet.public_subnet.*.id
  enable_deletion_protection = var.alb.enable_deletion_protection
  drop_invalid_header_fields = true

  access_logs {
    bucket  = aws_s3_bucket.alb_log_bucket[0].id
    prefix  = "access"
    enabled = true
  }

  connection_logs {
    bucket  = aws_s3_bucket.alb_log_bucket[0].id
    prefix  = "connection"
    enabled = true
  }

  tags = merge(
    var.vpc.tags,
    {
      Name = "${var.region.label}.${var.dns.zonename}-alb"
    }
  )
}

locals {
  # Look up the certificate ARN for this zone's domain name
  alb_certificate_arn = try(var.cert_map[var.dns.zonename].arn, "")
}

resource "aws_lb_listener" "https" {
  count             = var.alb.enabled && local.alb_certificate_arn != "" ? 1 : 0
  load_balancer_arn = aws_lb.lb_public[0].arn
  port              = "443"
  protocol          = "HTTPS"
  ssl_policy        = var.alb.ssl_policy
  certificate_arn   = local.alb_certificate_arn

  default_action {
    type = "fixed-response"
    fixed_response {
      content_type = "text/plain"
      message_body = "404 page not found - ${var.region.label}.${var.dns.zonename}"
      status_code  = "404"
    }
  }

  tags = merge(
    var.vpc.tags,
    {
      Name = "${var.region.label}.${var.dns.zonename}-alb-https-listener"
    }
  )
}

# S3 bucket for ALB logs
resource "aws_s3_bucket" "alb_log_bucket" {
  count         = var.alb.enabled ? 1 : 0
  bucket        = "logs-alb-${var.region.label}-${var.site.label}-${var.site.random_suffix}"
  force_destroy = var.alb.logs_force_destroy

  tags = merge(
    var.vpc.tags,
    {
      Name = "${var.region.label}.${var.dns.zonename}-alb-logs"
    }
  )
}

resource "aws_s3_bucket_server_side_encryption_configuration" "alb_log_bucket_encryption" {
  count  = var.alb.enabled ? 1 : 0
  bucket = aws_s3_bucket.alb_log_bucket[0].id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

# Block public access to ALB log bucket
resource "aws_s3_bucket_public_access_block" "alb_log_bucket" {
  count  = var.alb.enabled ? 1 : 0
  bucket = aws_s3_bucket.alb_log_bucket[0].id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# Lifecycle configuration for ALB log bucket
resource "aws_s3_bucket_lifecycle_configuration" "alb_log_bucket" {
  count  = var.alb.enabled ? 1 : 0
  bucket = aws_s3_bucket.alb_log_bucket[0].id

  rule {
    id     = "expire-old-logs"
    status = "Enabled"

    expiration {
      days = 90
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

# Use the recommended service principal for ALB access logging
# https://docs.aws.amazon.com/elasticloadbalancing/latest/application/enable-access-logging.html
resource "aws_s3_bucket_policy" "alb_log_bucket_policy" {
  count  = var.alb.enabled ? 1 : 0
  bucket = aws_s3_bucket.alb_log_bucket[0].id

  policy = jsonencode({
    "Version" : "2012-10-17",
    "Statement" : [
      {
        "Effect" : "Allow",
        "Principal" : {
          "Service" : "logdelivery.elasticloadbalancing.amazonaws.com"
        },
        "Action" : "s3:PutObject",
        "Resource" : [
          "arn:aws:s3:::${aws_s3_bucket.alb_log_bucket[0].bucket}/access/AWSLogs/${data.aws_caller_identity.current.account_id}/*",
          "arn:aws:s3:::${aws_s3_bucket.alb_log_bucket[0].bucket}/connection/AWSLogs/${data.aws_caller_identity.current.account_id}/*"
        ]
      }
    ]
  })
}
