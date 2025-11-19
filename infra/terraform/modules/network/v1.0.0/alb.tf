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
      message_body = "404 Not Found"
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
  bucket        = "logs-alb-${replace(var.region.label, ".", "-")}-${replace(var.dns.zonename, ".", "-")}-${var.site.random_suffix}"
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

# NOTE: Each region has its own account where the access logs come from
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
          "AWS" : [
            "arn:aws:iam::797873946194:root",  # us-east-1
            "arn:aws:iam::127311923021:root",  # us-east-2
            "arn:aws:iam::985666609251:root"   # ca-central-1
          ]
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
