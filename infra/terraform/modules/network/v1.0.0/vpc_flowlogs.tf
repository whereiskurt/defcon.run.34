resource "random_id" "rnd" {
  byte_length = 4
}

data "aws_caller_identity" "current" {}

resource "aws_flow_log" "vpc_flow_logs" {
  count                    = var.vpc_flow_logs.enabled ? 1 : 0
  log_destination          = aws_s3_bucket.vpc_flow_logs[0].arn
  log_destination_type     = "s3"
  traffic_type             = var.vpc_flow_logs.traffic_type
  vpc_id                   = aws_vpc.vpc.id
  max_aggregation_interval = var.vpc_flow_logs.max_aggregation_interval

  # Ensure bucket policy is created and propagated before flow log
  depends_on = [aws_s3_bucket_policy.vpc_flow_logs_bucket_policy]

  tags = merge(
    var.vpc.tags,
    {
      Name = "${var.region.label}.${var.dns.zonename}-vpc-flow-logs"
    }
  )
}

resource "aws_s3_bucket" "vpc_flow_logs" {
  count         = var.vpc_flow_logs.enabled ? 1 : 0
  bucket        = "logs-vpc-flow-${var.region.label}-${var.dns.zonename}-${var.site.random_suffix}"
  force_destroy = var.vpc_flow_logs.force_destroy

  tags = merge(
    var.vpc.tags,
    {
      Name = "${var.region.label}.${var.dns.zonename}-vpc-flow-logs"
    }
  )
}

resource "aws_s3_bucket_policy" "vpc_flow_logs_bucket_policy" {
  count  = var.vpc_flow_logs.enabled ? 1 : 0
  bucket = aws_s3_bucket.vpc_flow_logs[0].id

  policy = jsonencode({
    Version = "2012-10-17",
    Statement = [
      {
        Sid    = "AWSLogDeliveryWrite",
        Effect = "Allow",
        Principal = {
          Service = "delivery.logs.amazonaws.com"
        },
        Action   = "s3:PutObject",
        Resource = "arn:aws:s3:::${aws_s3_bucket.vpc_flow_logs[0].bucket}/*",
        Condition = {
          StringEquals = {
            "s3:x-amz-acl"      = "bucket-owner-full-control",
            "aws:SourceAccount" = data.aws_caller_identity.current.account_id
          }
        }
      },
      {
        Sid    = "AWSLogDeliveryAclCheck",
        Effect = "Allow",
        Principal = {
          Service = "delivery.logs.amazonaws.com"
        },
        Action   = "s3:GetBucketAcl",
        Resource = "arn:aws:s3:::${aws_s3_bucket.vpc_flow_logs[0].bucket}",
        Condition = {
          StringEquals = {
            "aws:SourceAccount" = data.aws_caller_identity.current.account_id
          }
        }
      }
    ]
  })
}
