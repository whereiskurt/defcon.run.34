data "aws_caller_identity" "current" {}

# ─── Node Role (used by both EC2 instance profile and ECS task role) ───

resource "aws_iam_role" "node" {
  count = var.waffaw.enabled ? 1 : 0

  name = "waffaw-node-${var.region.label}-${var.site.random_suffix}"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Principal = {
          Service = ["ecs-tasks.amazonaws.com", "ec2.amazonaws.com"]
        }
        Action = "sts:AssumeRole"
      }
    ]
  })

  tags = {
    Name   = "waffaw-node-${var.region.label}"
    Region = var.region.label
    Site   = var.site.label
  }
}

resource "aws_iam_role_policy" "node" {
  count = var.waffaw.enabled ? 1 : 0

  name = "waffaw-node-policy"
  role = aws_iam_role.node[0].id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "S3ControlBucket"
        Effect = "Allow"
        Action = [
          "s3:GetObject",
          "s3:PutObject",
          "s3:DeleteObject",
          "s3:ListBucket"
        ]
        Resource = [
          aws_s3_bucket.control[0].arn,
          "${aws_s3_bucket.control[0].arn}/*"
        ]
      },
      {
        Sid    = "CloudWatchLogs"
        Effect = "Allow"
        Action = [
          "logs:CreateLogStream",
          "logs:PutLogEvents",
          "logs:CreateLogGroup"
        ]
        Resource = "${aws_cloudwatch_log_group.waffaw[0].arn}:*"
      },
      {
        Sid    = "ECRPull"
        Effect = "Allow"
        Action = [
          "ecr:GetDownloadUrlForLayer",
          "ecr:BatchGetImage",
          "ecr:GetAuthorizationToken"
        ]
        Resource = "*"
      }
    ]
  })
}

# Instance profile for EC2 nodes
resource "aws_iam_instance_profile" "node" {
  count = var.waffaw.enabled && var.waffaw.ec2_count > 0 ? 1 : 0

  name = "waffaw-node-${var.region.label}-${var.site.random_suffix}"
  role = aws_iam_role.node[0].name
}

# ─── ECS Task Execution Role ───

resource "aws_iam_role" "ecs_execution" {
  count = var.waffaw.enabled ? 1 : 0

  name = "waffaw-ecs-exec-${var.region.label}-${var.site.random_suffix}"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Principal = {
          Service = "ecs-tasks.amazonaws.com"
        }
        Action = "sts:AssumeRole"
      }
    ]
  })

  tags = {
    Name   = "waffaw-ecs-exec-${var.region.label}"
    Region = var.region.label
    Site   = var.site.label
  }
}

resource "aws_iam_role_policy_attachment" "ecs_execution" {
  count = var.waffaw.enabled ? 1 : 0

  role       = aws_iam_role.ecs_execution[0].name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

resource "aws_iam_role_policy" "ecs_execution_logs" {
  count = var.waffaw.enabled ? 1 : 0

  name = "waffaw-ecs-exec-logs"
  role = aws_iam_role.ecs_execution[0].id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "logs:CreateLogGroup"
        ]
        Resource = "arn:aws:logs:${var.region.full}:${data.aws_caller_identity.current.account_id}:log-group:/waffaw/*"
      }
    ]
  })
}

# ─── Firehose Delivery Role ───

resource "aws_iam_role" "firehose" {
  count = var.waffaw.enabled ? 1 : 0

  name = "waffaw-firehose-${var.region.label}-${var.site.random_suffix}"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Principal = {
          Service = "firehose.amazonaws.com"
        }
        Action = "sts:AssumeRole"
      }
    ]
  })

  tags = {
    Name   = "waffaw-firehose-${var.region.label}"
    Region = var.region.label
    Site   = var.site.label
  }
}

resource "aws_iam_role_policy" "firehose" {
  count = var.waffaw.enabled ? 1 : 0

  name = "waffaw-firehose-policy"
  role = aws_iam_role.firehose[0].id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "S3Write"
        Effect = "Allow"
        Action = [
          "s3:PutObject",
          "s3:GetBucketLocation",
          "s3:AbortMultipartUpload",
          "s3:ListBucket",
          "s3:ListBucketMultipartUploads"
        ]
        Resource = [
          aws_s3_bucket.logs[0].arn,
          "${aws_s3_bucket.logs[0].arn}/*"
        ]
      },
      {
        Sid    = "CloudWatchLogs"
        Effect = "Allow"
        Action = [
          "logs:GetLogEvents"
        ]
        Resource = "${aws_cloudwatch_log_group.waffaw[0].arn}:*"
      }
    ]
  })
}

# ─── CloudWatch Logs to Firehose Role ───

resource "aws_iam_role" "cw_to_firehose" {
  count = var.waffaw.enabled ? 1 : 0

  name = "waffaw-cw-firehose-${var.region.label}-${var.site.random_suffix}"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Principal = {
          Service = "logs.${var.region.full}.amazonaws.com"
        }
        Action = "sts:AssumeRole"
        Condition = {
          StringLike = {
            "aws:SourceArn" = "arn:aws:logs:${var.region.full}:${data.aws_caller_identity.current.account_id}:log-group:/waffaw/*"
          }
        }
      }
    ]
  })

  tags = {
    Name   = "waffaw-cw-firehose-${var.region.label}"
    Region = var.region.label
    Site   = var.site.label
  }
}

resource "aws_iam_role_policy" "cw_to_firehose" {
  count = var.waffaw.enabled ? 1 : 0

  name = "waffaw-cw-firehose-policy"
  role = aws_iam_role.cw_to_firehose[0].id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "firehose:PutRecord",
          "firehose:PutRecordBatch"
        ]
        Resource = aws_kinesis_firehose_delivery_stream.waffaw[0].arn
      }
    ]
  })
}

# ─── Athena/Glue Role (used by ConfigUI) ───

resource "aws_iam_role" "athena" {
  count = var.waffaw.enabled ? 1 : 0

  name = "waffaw-athena-${var.region.label}-${var.site.random_suffix}"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Principal = {
          Service = "athena.amazonaws.com"
        }
        Action = "sts:AssumeRole"
      }
    ]
  })

  tags = {
    Name   = "waffaw-athena-${var.region.label}"
    Region = var.region.label
    Site   = var.site.label
  }
}

resource "aws_iam_role_policy" "athena" {
  count = var.waffaw.enabled ? 1 : 0

  name = "waffaw-athena-policy"
  role = aws_iam_role.athena[0].id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "Athena"
        Effect = "Allow"
        Action = [
          "athena:StartQueryExecution",
          "athena:GetQueryExecution",
          "athena:GetQueryResults"
        ]
        Resource = "arn:aws:athena:${var.region.full}:${data.aws_caller_identity.current.account_id}:workgroup/waffaw"
      },
      {
        Sid    = "Glue"
        Effect = "Allow"
        Action = [
          "glue:GetTable",
          "glue:GetDatabase"
        ]
        Resource = [
          "arn:aws:glue:${var.region.full}:${data.aws_caller_identity.current.account_id}:catalog",
          "arn:aws:glue:${var.region.full}:${data.aws_caller_identity.current.account_id}:database/waffaw",
          "arn:aws:glue:${var.region.full}:${data.aws_caller_identity.current.account_id}:table/waffaw/*"
        ]
      },
      {
        Sid    = "S3Read"
        Effect = "Allow"
        Action = [
          "s3:GetObject",
          "s3:ListBucket"
        ]
        Resource = [
          aws_s3_bucket.logs[0].arn,
          "${aws_s3_bucket.logs[0].arn}/*"
        ]
      },
      {
        Sid    = "S3AthenaResults"
        Effect = "Allow"
        Action = [
          "s3:PutObject",
          "s3:GetObject"
        ]
        Resource = "${aws_s3_bucket.logs[0].arn}/athena-results/*"
      }
    ]
  })
}
